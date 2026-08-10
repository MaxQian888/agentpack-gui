"use client"

import { useEffect, useMemo, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { MoreTokenSection } from "."
import { PersonalMoreTokenSection } from "./personal"
import { createMoreTokenE2EPort, type MoreTokenFixtureRole } from "@/lib/more-token/e2e-fixture"
import { setMoreTokenPortForTests } from "@/lib/more-token/port"
import type { ManagementView, PersonalView } from "@/lib/more-token/types"

const localUsage = { data: null, loading: false, request: () => undefined }

export function MoreTokenE2EFixture() {
  const [role, setRole] = useState<MoreTokenFixtureRole>("root")
  const [managementView, setManagementView] = useState<ManagementView>("accounts")
  const [personalView, setPersonalView] = useState<PersonalView>("my-account")

  const selectRole = (nextRole: MoreTokenFixtureRole) => {
    setRole(nextRole)
    if (nextRole === "child") setPersonalView("my-account")
    else setManagementView("accounts")
  }

  return (
    <main className="min-h-dvh bg-background p-3 text-foreground sm:p-5">
      <header className="mx-auto mb-4 flex max-w-6xl flex-col gap-3 border-b pb-4">
        <h1 className="text-lg font-semibold">More-token E2E fixture</h1>
        <div className="flex flex-wrap gap-2" aria-label="Fixture roles">
          {(["root", "master", "child"] as const).map((item) => (
            <Button
              key={item}
              size="sm"
              variant={role === item ? "default" : "outline"}
              onClick={() => selectRole(item)}
            >
              {item[0].toUpperCase() + item.slice(1)} role
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Fixture views">
          {role === "child" ? (
            <>
              <Button
                size="sm"
                variant={personalView === "my-account" ? "secondary" : "ghost"}
                onClick={() => setPersonalView("my-account")}
              >
                Account view
              </Button>
              <Button
                size="sm"
                variant={personalView === "my-balance" ? "secondary" : "ghost"}
                onClick={() => setPersonalView("my-balance")}
              >
                Balance view
              </Button>
              <Button
                size="sm"
                variant={personalView === "my-security" ? "secondary" : "ghost"}
                onClick={() => setPersonalView("my-security")}
              >
                Security view
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant={managementView === "accounts" ? "secondary" : "ghost"}
              onClick={() => setManagementView("accounts")}
            >
              Accounts view
            </Button>
          )}
        </div>
      </header>
      <FixtureWorkbench
        key={role}
        role={role}
        managementView={managementView}
        personalView={personalView}
      />
    </main>
  )
}

function FixtureWorkbench({
  role,
  managementView,
  personalView,
}: {
  role: MoreTokenFixtureRole
  managementView: ManagementView
  personalView: PersonalView
}) {
  const port = useMemo(() => createMoreTokenE2EPort(role), [role])
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })
  )
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setMoreTokenPortForTests(port)
    const readyTimer = window.setTimeout(() => setReady(true), 0)
    return () => {
      window.clearTimeout(readyTimer)
      setMoreTokenPortForTests(null)
    }
  }, [port])

  if (!ready)
    return <p className="mx-auto max-w-6xl text-sm text-muted-foreground">Loading fixture…</p>
  return (
    <QueryClientProvider client={client}>
      {role === "child" ? (
        <PersonalMoreTokenSection view={personalView} />
      ) : (
        <MoreTokenSection view={managementView} localUsage={localUsage} />
      )}
    </QueryClientProvider>
  )
}
