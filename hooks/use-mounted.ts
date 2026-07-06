import * as React from "react"

/**
 * Returns `false` during SSR and the first client render, then `true` after
 * mount. Use it to gate runtime-only values (e.g. `isTauri()`) whose result
 * differs between the pre-rendered HTML and the client — reading them directly
 * during render causes a hydration mismatch.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])
  return mounted
}
