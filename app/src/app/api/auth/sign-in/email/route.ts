import { auth } from "@/utils/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { withAuthClientIp } from "@/lib/auth/better-auth-rate-limit";

export const { GET, POST } = toNextJsHandler((request: Request) => auth.handler(withAuthClientIp(request)));
