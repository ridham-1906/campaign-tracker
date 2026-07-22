"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionState } from "./actions";
import { Eye, EyeClosed } from "lucide-react";

type Props = {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
};

export function AuthForm({ action }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [showPass, setShowPass] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@company.com"
          autoComplete="email"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <div className="flex justify-center items-center relative">
          <Input
            id="password"
            name="password"
            type={showPass ? "text" : "password"}
            autoComplete="current-password"
            required
          />
          <span className="absolute right-2 hover:cursor-pointer" onClick={() => setShowPass(!showPass)}>
            {
              !showPass ? <Eye className="h-4" /> : <EyeClosed className="h-4" />
            }
          </span>
        </div>
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Please wait…" : "Sign in"}
      </Button>
    </form>
  );
}
