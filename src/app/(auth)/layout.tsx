export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1a1f2e]">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
