"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE_NAME,
  USER_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  checkPassword,
  expectedSessionValue,
} from "@/lib/auth";

export async function login(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const from = String(formData.get("from") ?? "/review");

  if (!name) {
    redirect(`/login?error=name&from=${encodeURIComponent(from)}`);
  }

  const ok = await checkPassword(password);
  if (!ok) {
    redirect(`/login?error=password&from=${encodeURIComponent(from)}`);
  }

  const sessionValue = await expectedSessionValue();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  cookieStore.set(USER_COOKIE_NAME, name, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });

  redirect(from || "/review");
}
