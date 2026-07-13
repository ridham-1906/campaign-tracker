"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/models";
import { createSession, destroySession, verifyPassword } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export type ActionState = { error?: string } | undefined;

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await connectDB();
  const user = await User.findOne({ email: parsed.data.email.toLowerCase() });
  if (!user || !(await verifyPassword(parsed.data.password, user.password))) {
    return { error: "Invalid email or password" };
  }

  await createSession({
    userId: user._id.toString(),
    name: user.name,
    email: user.email,
  });
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
