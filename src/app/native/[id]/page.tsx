import NativeSession from "@/components/NativeSession";

export const instant = false;

// Thin server wrapper: attempt state always comes from /api/native at runtime.
export default async function NativeAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NativeSession attemptId={id} />;
}
