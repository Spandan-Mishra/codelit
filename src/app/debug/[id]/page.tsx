import DebugClient from "@/components/DebugClient";

export const instant = false;

export default async function DebugPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DebugClient id={id} />;
}
