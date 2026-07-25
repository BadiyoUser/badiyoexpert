import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/otp")({
  head: () => ({
    meta: [
      { title: "Verify code — Badiyo Expert" },
      { name: "description", content: "Enter the 4-digit code sent to your mobile number." },
    ],
  }),
  component: OtpScreen,
});

function OtpScreen() {
  const [digits, setDigits] = useState<string[]>(["", "", "", ""]);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const navigate = useNavigate();
  const complete = digits.every((d) => d !== "");

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  const setAt = (i: number, val: string) => {
    const v = val.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
    if (v && i < 3) inputsRef.current[i + 1]?.focus();
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background px-6 pb-8 pt-6">
      <Link
        to="/login"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
        aria-label="Back"
      >
        <ChevronLeft className="h-6 w-6" />
      </Link>

      <div className="mt-6">
        <h1 className="text-[28px] font-bold leading-tight text-foreground">
          Enter verification code
        </h1>
        <p className="mt-2 text-[15px] text-[color:var(--text-secondary)]">
          We sent a 4-digit code to your mobile. Enter it below to verify.
        </p>
      </div>

      <form
        className="mt-10 flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (complete) navigate({ to: "/home" });
        }}
      >
        <div className="flex items-center justify-between gap-3">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                inputsRef.current[i] = el;
              }}
              type="tel"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => setAt(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !digits[i] && i > 0) {
                  inputsRef.current[i - 1]?.focus();
                }
              }}
              className="h-16 w-16 flex-1 rounded-[14px] border border-border bg-card text-center text-[26px] font-bold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          ))}
        </div>

        <button
          type="button"
          className="mt-6 self-start text-[14px] font-semibold text-primary"
        >
          Resend code in 30s
        </button>

        <div className="mt-auto pt-8">
          <button
            type="submit"
            disabled={!complete}
            className="h-[52px] w-full rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[0_6px_20px_-6px_rgba(0,185,122,0.5)] transition active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
          >
            Verify
          </button>
        </div>
      </form>
    </div>
  );
}
