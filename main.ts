import {
  Application,
  Router,
  RouterContext,
} from "https://deno.land/x/oak@v12.6.2/mod.ts";
import "jsr:@std/dotenv/load";
import { randomBytes, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { bold } from "jsr:@std/internal@^1.0.5/styles";

const kv = await Deno.openKv();

const app = new Application();
const router = new Router();

const clientID = "v";

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
    if (token) {
      kv.set([`auth_token_${token}`], {
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
  const iter = kv.list({ prefix: ["auth_token_"] });
  const tokens = [];
  for await (const res of iter) tokens.push(res);
  ctx.response.body = {
    status: "success",
    tokens: tokens,
  };
});

//deleteToken
router.delete("/deleteToken/:token", async (ctx) => {
  try {
    const token = ctx.params.token;
    await kv.delete([`auth_token_${token}`]);
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
