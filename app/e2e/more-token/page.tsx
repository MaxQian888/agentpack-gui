import { notFound } from "next/navigation"
import { MoreTokenE2EFixture } from "@/components/agentpack/sections/more-token/e2e-fixture"

export default function MoreTokenE2EPage() {
  if (process.env.NEXT_PUBLIC_AGENTPACK_E2E_FIXTURES !== "1") notFound()
  return <MoreTokenE2EFixture />
}
