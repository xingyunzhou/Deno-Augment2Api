import {
  Application,
  Router,
  RouterContext,
} from "https://deno.land/x/oak@v12.6.2/mod.ts";
import "jsr:@std/dotenv/load";
import { randomBytes, createHash } from "node:crypto";
import { Buffer } from "node:buffer";

const kv = await Deno.openKv();

const app = new Application();
const router = new Router();

const clientID = "v";


// 模型接口定义
interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface OpenAIModelList {
  object: string;
  data: OpenAIModel[];
}


interface TokenData {
  token: string;
  tenant_url: string;
  created_at: number;
}

// 定义接口
interface OpenAIRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Choice[];
  usage: Usage;
}

interface OpenAIStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: StreamChoice[];
}

interface StreamChoice {
  index: number;
  delta: ChatMessage;
  finish_reason: string | null;
}

interface Choice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

interface ChatMessage {
  role: string;
  content: string | any;
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface AugmentRequest {
  chat_history: AugmentChatHistory[];
  message: string;
  mode: string;
}

interface AugmentChatHistory {
  response_text: string;
  request_message: string;
}

interface AugmentResponse {
  text: string;
  done: boolean;
}

function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function sha256Hash(input: string | Buffer): Buffer {
  return createHash("sha256").update(input).digest();
}

function createOAuthState() {
  const codeVerifier = base64URLEncode(randomBytes(32));
  const codeChallenge = base64URLEncode(sha256Hash(Buffer.from(codeVerifier)));
  const state = base64URLEncode(randomBytes(8));

  const oauthState = {
    codeVerifier,
    codeChallenge,
    state,
    creationTime: Date.now(),
  };

  console.log(oauthState);
  return oauthState;
}

const generateAuthorizeURL = (oauthState: {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  creationTime: number;
}) => {
  const params = new URLSearchParams({
    response_type: "code",
    code_challenge: oauthState.codeChallenge,
    client_id: clientID,
    state: oauthState.state,
    prompt: "login",
  });
  const authorizeUrl = new URL(
    `/authorize?${params.toString()}`,
    "https://auth.augmentcode.com"
  );
  return authorizeUrl.toString();
};

const getAccessToken = async (
  tenant_url: string,
  codeVerifier: string,
  code: string
) => {
  const data = {
    grant_type: "authorization_code",
    client_id: clientID,
    code_verifier: codeVerifier,
    redirect_uri: "",
    code: code,
  };
  const response = await fetch(`${tenant_url}token`, {
    method: "POST",
    body: JSON.stringify(data),
    redirect: "follow",
    headers: {
      "Content-Type": "application/json",
    },
  });
  const json = await response.json();
  const token = json.access_token;
  return token;
};

router.get("/auth", (ctx: RouterContext<"/auth", Record<string, string>>) => {
  const oauthState = createOAuthState();
  const authorizeUrl = generateAuthorizeURL(oauthState);

  kv.set([`auth_codeVerifier_${oauthState.state}`], oauthState.codeVerifier, {
    //milliseconds 1000 = 1 second
    expireIn: 60 * 1000,
  });
  ctx.response.body = {
    status: "success",
    authorizeUrl: authorizeUrl,
  };
});

router.post("/getToken", async (ctx) => {
  const code = await ctx.request.body().value;
  if (code) {
    const parsedCode = {
      code: code.code,
      state: code.state,
      tenant_url: code.tenant_url,
    }
    console.log(parsedCode);
    const codeVerifier = await kv.get([`auth_codeVerifier_${parsedCode.state}`]);
    const token = await getAccessToken(parsedCode.tenant_url, codeVerifier.value as string, parsedCode.code);
    console.log(token);
    if (token) {
      kv.set([`auth_token`, token], {
        token: token,
        tenant_url: parsedCode.tenant_url,
        created_at: Date.now(),
      });
      ctx.response.body = {
        status: "success",
        token: token,
      };
    } else {
      ctx.response.body = {
        status: "error",
        message: "Failed to get token",
      };
    }
  } else {
    ctx.response.body = {
      status: "error",
      message: "No code provided",
    };
  }
});


//getTokens
router.get("/getTokens", async (ctx: RouterContext<"/getTokens", Record<string, string>>) => {
  const iter = kv.list({ prefix: ["auth_token"] });
  console.log(iter);
  const tokens = [];
  for await (const res of iter) tokens.push(res);
  const tokenData = tokens.map((entry) => {
    const value = entry.value as { token: string; tenant_url: string; created_at: number };
    return {
      token: value.token,
      tenant_url: value.tenant_url,
      created_at: value.created_at,
    };
  });

  ctx.response.body = {
    status: "success",
    tokens: tokenData,
  };
});

//deleteToken
router.delete("/deleteToken/:token", async (ctx) => {
  try {
    const token = ctx.params.token;
    await kv.delete([`auth_token`, token]);
    ctx.response.body = {
      status: "success",
    };
  } catch (_error) {
    ctx.response.body = {
      status: "error",
      message: "Failed to delete token",
    };
  }
});

//v1/chat/completions
router.post("/v1/chat/completions", async (ctx) => {
  // 获取token
  const iter = kv.list({ prefix: ["auth_token"] });
  const tokens = [];
  for await (const res of iter) tokens.push(res);
  if (tokens.length === 0) {
    ctx.response.body = {
      status: "error",
      message: "无可用Token,请先在管理页面获取",
    };
    return;
  }

  // 随机获取一个token
  const tokenData = tokens[Math.floor(Math.random() * tokens.length)].value as TokenData;
  const { token, tenant_url } = tokenData;

  // 解析请求体
  const body = await ctx.request.body().value as OpenAIRequest;

  // 转换为Augment请求格式
  const augmentReq = convertToAugmentRequest(body);

  // 处理流式请求
  if (body.stream) {
    return handleStreamRequest(ctx, augmentReq, body.model, token, tenant_url);
  }

  // 处理非流式请求
  return handleNonStreamRequest(ctx, augmentReq, body.model, token, tenant_url);
});

// 处理流式请求
async function handleStreamRequest(
  ctx: any,
  augmentReq: AugmentRequest,
  model: string,
  token: string,
  tenant_url: string
) {
  ctx.response.type = "text/event-stream";
  ctx.response.headers.set("Cache-Control", "no-cache");
  ctx.response.headers.set("Connection", "keep-alive");

  const encoder = new TextEncoder();
  const body = JSON.stringify(augmentReq);

  try {
    const response = await fetch(`${tenant_url}chat-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body
    });

    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("无法获取响应流");
    }

    const responseID = `chatcmpl-${Date.now()}`;
    let fullText = "";
    const decoder = new TextDecoder();
    let buffer = "";

    const stream = new ReadableStream({
      async start(controller) {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            // 发送[DONE]标记
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            try {
              const augmentResp = JSON.parse(trimmedLine) as AugmentResponse;
              fullText += augmentResp.text;

              const streamResp: OpenAIStreamResponse = {
                id: responseID,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{
                  index: 0,
                  delta: {
                    role: "assistant",
                    content: augmentResp.text
                  },
                  finish_reason: augmentResp.done ? "stop" : null
                }]
              };

              controller.enqueue(encoder.encode(`data: ${JSON.stringify(streamResp)}\n\n`));

              if (augmentResp.done) {
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                controller.close();
                return;
              }
            } catch (e) {
              console.error("解析响应失败:", e);
            }
          }
        }

        controller.close();
      }
    });

    ctx.response.body = stream;
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      status: "error",
      message: `请求失败: ${error instanceof Error ? error.message : '未知错误'}`
    };
  }
}

// 处理非流式请求
async function handleNonStreamRequest(ctx: any, augmentReq: AugmentRequest, model: string, token: string, tenant_url: string) {
  try {
    const response = await fetch(`${tenant_url}chat-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(augmentReq)
    });

    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("无法获取响应流");
    }

    let fullText = "";
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        try {
          const augmentResp = JSON.parse(trimmedLine) as AugmentResponse;
          fullText += augmentResp.text;

          if (augmentResp.done) break;
        } catch (e) {
          console.error("解析响应失败:", e);
        }
      }
    }

    // 估算token数量
    const promptTokens = estimateTokenCount(augmentReq.message);
    let historyTokens = 0;
    for (const history of augmentReq.chat_history) {
      historyTokens += estimateTokenCount(history.request_message);
      historyTokens += estimateTokenCount(history.response_text);
    }
    const completionTokens = estimateTokenCount(fullText);

    const openAIResp: OpenAIResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: fullText
        },
        finish_reason: "stop"
      }],
      usage: {
        prompt_tokens: promptTokens + historyTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + historyTokens + completionTokens
      }
    };

    ctx.response.body = openAIResp;
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      status: "error",
      message: `请求失败: ${error instanceof Error ? error.message : '未知错误'}`
    };
  }
}



// 辅助函数
function getMessageContent(message: ChatMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  } else if (Array.isArray(message.content)) {
    let result = '';
    for (const item of message.content) {
      if (item && typeof item === 'object' && 'text' in item) {
        result += item.text;
      }
    }
    return result;
  }
  return '';
}

function convertToAugmentRequest(req: OpenAIRequest): AugmentRequest {
  const augmentReq: AugmentRequest = {
    mode: "CHAT",
    message: '',
    chat_history: []
  };

  if (req.messages.length > 0) {
    const lastMsg = req.messages[req.messages.length - 1];
    augmentReq.message = getMessageContent(lastMsg);
  }

  const history: AugmentChatHistory[] = [];
  for (let i = 0; i < req.messages.length - 1; i += 2) {
    if (i + 1 < req.messages.length) {
      history.push({
        request_message: getMessageContent(req.messages[i]),
        response_text: getMessageContent(req.messages[i + 1])
      });
    }
  }

  augmentReq.chat_history = history;
  return augmentReq;
}

// 估算token数量
function estimateTokenCount(text: string): number {
  const words = text.split(/\s+/).length;
  let chineseCount = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fff]/.test(char)) {
      chineseCount++;
    }
  }
  return words + Math.floor(chineseCount * 0.75);
}

//v1/models
router.get("/v1/models", (ctx) => {
  const models: OpenAIModelList = {
    object: "list",
    data: [
      {
        id: "claude-3-7-sonnet-20250219",
        object: "model",
        created: 1708387201,
        owned_by: "anthropic",
      },
      {
        id: "claude-3.7",
        object: "model",
        created: 1708387200,
        owned_by: "anthropic",
      },
    ]
  };

  ctx.response.body = models;
});

app.use(router.routes());
app.use(router.allowedMethods());

app.use(async (ctx) => {
  try {
    await ctx.send({
      root: `${Deno.cwd()}/static`,
      index: "index.html",
    });
  } catch {
    ctx.response.status = 404;
    ctx.response.body = "404 File not found";
  }
});

app.listen({ port: 4242 });

console.log("Server is running on http://localhost:4242");
