import AppPageShell from "@/components/AppPageShell";
import MapWithChatClient from "@/components/MapWithChatClient";

export default function MapPage() {
  return (
    <AppPageShell fill padding="none" variant="none" width="full">
      <MapWithChatClient />
    </AppPageShell>
  );
}