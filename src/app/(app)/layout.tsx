import Header from "@/components/Header";
import { AuthProvider } from "@/components/AuthProvider";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthProvider>
      <Header />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto w-full bg-neutral-200 dark:bg-neutral-800">
        {children}
      </main>
    </AuthProvider>
  );
}
