"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FaGoogle } from "react-icons/fa";
import { AiOutlineAntDesign } from "react-icons/ai";

import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import Image from "next/image";

type AuthMode = "login" | "signup";

function getSafeNextPath(nextPath: string | null) {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/dashboard";
  }

  return nextPath;
}

interface AuthPageProps {
  mode: AuthMode;
}

export function AuthPage({ mode }: AuthPageProps) {
  const isSignup = mode === "signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = getSafeNextPath(searchParams.get("next"));

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      if (isSignup) {
        const { error: signupError } = await authClient.signUp.email({
          name,
          email,
          password,
          callbackURL: nextPath,
        });

        if (signupError) {
          setError(signupError.message ?? "Signup failed");
          return;
        }
      } else {
        const { error: loginError } = await authClient.signIn.email({
          email,
          password,
          callbackURL: nextPath,
          rememberMe: true,
        });

        if (loginError) {
          setError(loginError.message ?? "Login failed");
          return;
        }
      }

      router.push(nextPath);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  const onGoogleSignIn = async () => {
    setError(null);
    setIsPending(true);

    try {
      const { error: socialError } = await authClient.signIn.social({
        provider: "google",
        callbackURL: nextPath,
      });

      if (socialError) {
        setError(socialError.message ?? "Google sign-in failed");
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
        <div className={cn("flex flex-col gap-6")}>
          <div className="mb-6 flex items-center gap-3">
            <Link
              href="/"
              className="hover:opacity-80 flex items-center justify-center gap-1 text-xl font-semibold"
            >
              <Image
                src="/voxalLogoTransparent.png"
                alt="Logo"
                width={28}
                height={28}
              />
              Voxal
            </Link>
            <div className="h-6 w-px bg-white" />
            <h1 className="text-xl font-semibold tracking-tight text-white">
              {isSignup ? "Create an account" : "Welcome back"}
            </h1>
          </div>
          <Card className="border-cyan-300/20 bg-slate-950/70 backdrop-blur-xl">
            <CardHeader>
              <CardTitle>
                {isSignup ? "Create your account" : "Log in to your account"}
              </CardTitle>
              <CardDescription>
                {isSignup
                  ? "Enter your information below to create your account"
                  : "Enter your email below to log in to your account"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit}>
                <FieldGroup>
                  {isSignup ? (
                    <Field>
                      <FieldLabel htmlFor="name">Name</FieldLabel>
                      <Input
                        id="name"
                        placeholder="John Doe"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </Field>
                  ) : null}

                  <Field>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <Input
                      id="email"
                      type="email"
                      placeholder="john@treehacks.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </Field>

                  <Field>
                    <div className="flex items-center">
                      <FieldLabel htmlFor="password">Password</FieldLabel>
                      <Button
                        type="button"
                        variant="link"
                        className="ml-auto h-auto p-0 text-sm text-cyan-200"
                        disabled
                      >
                        Forgot your password?
                      </Button>
                    </div>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Minimum 10 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                    />
                  </Field>

                  <Field>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={isPending}
                    >
                      {isPending
                        ? "Please wait..."
                        : isSignup
                          ? "Sign up"
                          : "Log in"}
                    </Button>
                    <Button
                      variant="outline"
                      type="button"
                      className="w-full border-cyan-300/25 bg-slate-900/40 hover:bg-slate-800/60"
                      onClick={onGoogleSignIn}
                      disabled={isPending}
                    >
                      <FaGoogle className="size-3.5" />
                      Log in with Google
                    </Button>
                    <FieldError>{error}</FieldError>
                    <FieldDescription className="text-center !mt-2">
                      {isSignup
                        ? "Already have an account? "
                        : "Don't have an account? "}
                      <Link
                        className="text-cyan-200 underline underline-offset-4"
                        href={isSignup ? "/login" : "/signup"}
                      >
                        {isSignup ? "Log in" : "Sign up"}
                      </Link>
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
