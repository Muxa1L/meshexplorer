import AppPageShell from "@/components/AppPageShell";
import PacketAnalyzer from "@/components/PacketAnalyzer";

export default function PacketsPage() {
  return (
    <AppPageShell fill padding="none" variant="none" width="full">
      <PacketAnalyzer />
    </AppPageShell>
  );
}
