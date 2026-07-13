import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { loginAction } from "../actions";
import { AuthForm } from "../auth-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">Campaign Tracker</CardTitle>
          <CardDescription>Sign in to manage your campaigns.</CardDescription>
        </CardHeader>
        <CardContent>
          <AuthForm action={loginAction} />
        </CardContent>
      </Card>
    </div>
  );
}
