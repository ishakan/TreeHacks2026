"use client";

import { ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

type SignOutButtonProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  redirectTo?: string;
};

export default function SignOutButton({
  redirectTo = "/login",
  ...buttonProps
}: SignOutButtonProps) {
  const router = useRouter();

  const onSignOut = async () => {
    await authClient.signOut();
    router.push(redirectTo);
    router.refresh();
  };

  return (
    <Button type="button" onClick={onSignOut} {...buttonProps}>
      Sign out
    </Button>
  );
}
