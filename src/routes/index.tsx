import { createFileRoute } from "@tanstack/react-router";
import { Maker } from "@/components/maker";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Maker />;
}
