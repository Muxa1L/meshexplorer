export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center overflow-y-auto bg-neutral-200 px-4 py-8 dark:bg-neutral-800">
      {children}
    </div>
  );
}