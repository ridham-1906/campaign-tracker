import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/models";
import { createSession, verifyPassword } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * JSON login for API clients (Postman). On success it sets the same
 * `campaign_session` httpOnly cookie the web app uses — the cookie jar then
 * authenticates every other /api/* call.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  if ("error" in body) return body.error;

  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return badRequest("Validation failed", parsed.error.issues);
  }

  await connectDB();
  const user = await User.findOne({ email: parsed.data.email.toLowerCase() });
  if (!user || !(await verifyPassword(parsed.data.password, user.password))) {
    return badRequest("Invalid email or password");
  }

  await createSession({
    userId: user._id.toString(),
    name: user.name,
    email: user.email,
  });

  return ok({
    id: user._id.toString(),
    name: user.name,
    email: user.email,
  });
}
