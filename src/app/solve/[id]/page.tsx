import SolveClient from "@/components/SolveClient";

export const instant = false;

export default async function SolvePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SolveClient id={id} />;
}
