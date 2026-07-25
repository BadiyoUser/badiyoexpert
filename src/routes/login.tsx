import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Phone } from "lucide-react";
import badiyoGreen from "@/assets/badiyo-green.png.asset.json";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Badiyo Expert" },
      { name: "description", content: "Sign in to Badiyo Expert with your mobile number." },
    ],
  }),
  component: LoginScreen,
});

function LoginScreen() {
  const [phone, setPhone] = useState("");
  const navigate = useNavigate();
  const valid = phone.replace(/\D/g, "").length >= 8;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background px-6 pb-8 pt-6">
      <div className="flex items-center justify-center py-8">
        <img src={badiyoGreen.url} alt="Badiyo" className="h-10 w-auto" />
      </div>

      <div className="mt-4">
        <h1 className="text-[28px] font-bold leading-tight text-foreground">
          Welcome, Expert
        </h1>
        <p className="mt-2 text-[15px] text-[color:var(--text-secondary)]">
          Enter your mobile number to continue. We'll send you a 4-digit code.
        </p>
      </div>

      <form
        className="mt-8 flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) navigate({ to: "/otp" });
        }}
      >
        <label className="text-[13px] font-semibold text-foreground">
          Mobile number
        </label>
        <div className="mt-2 flex items-center gap-2 rounded-[14px] border border-border bg-card px-4 h-[52px] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition">
          <Phone className="h-5 w-5 text-[color:var(--text-secondary)]" strokeWidth={2} />
          <span className="text-[15px] font-semibold text-foreground">+91</span>
          <div className="h-6 w-px bg-[color:var(--color-divider)]" />
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ""))}
            className="flex-1 bg-transparent text-[16px] font-medium text-foreground outline-none placeholder:text-[color:var(--text-secondary)]/60"
          />
        </div>

        <p className="mt-4 text-[13px] text-[color:var(--text-secondary)]">
          By continuing you agree to Badiyo's Terms of Service and Privacy Policy.
        </p>

        <div className="mt-auto pt-8">
          <button
            type="submit"
            disabled={!valid}
            className="h-[52px] w-full rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[0_6px_20px_-6px_rgba(0,185,122,0.5)] transition active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
          >
            Send code
          </button>
          <Link
            to="/"
            className="mt-4 flex items-center justify-center gap-1 text-[14px] font-semibold text-[color:var(--text-secondary)]"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </div>
      </form>
    </div>
  );
}
