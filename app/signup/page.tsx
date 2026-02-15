import { Suspense } from "react";
import { AuthPage } from "@/components/auth/auth-page";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <AuthPage mode="signup" />
    </Suspense>
  );
}
