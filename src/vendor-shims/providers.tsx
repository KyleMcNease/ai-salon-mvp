"use client";

import { PropsWithChildren } from "react";

export default function Providers({ children }: PropsWithChildren<Record<string, unknown>>) {
  return <>{children}</>;
}
