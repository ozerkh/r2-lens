import { Button, Empty, Loader } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { Me, SetupStatus } from "../shared/types";
import { api, ApiError } from "./api";
import { Login } from "./components/Login";
import { Shell } from "./components/Shell";

const Setup = lazy(() => import("./components/Setup"));
const Configure = lazy(() => import("./components/Configure"));

type State =
  | { status: "loading" }
  | { status: "unreachable"; message: string }
  | { status: "setup"; setup: SetupStatus; fromConfigure?: boolean }
  | { status: "configure"; setup: SetupStatus }
  | { status: "anonymous"; setup: SetupStatus; error?: string; problem?: string }
  | { status: "ready"; me: Me; setup?: SetupStatus };

const loader = (
  <div className="flex h-full items-center justify-center">
    <Loader size={28} />
  </div>
);

const signInError = new URLSearchParams(location.search).get("error") ?? undefined;
if (signInError) history.replaceState(null, "", location.pathname + location.hash);

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async (error?: string) => {
    const [setup, me] = await Promise.allSettled([api.setup(), api.me()]);
    if (setup.status === "rejected") {
      if (me.status === "fulfilled") return setState({ status: "ready", me: me.value });
      return setState({ status: "unreachable", message: (setup.reason as Error).message });
    }
    if (!setup.value.ready) return setState({ status: "setup", setup: setup.value });
    if (!error && me.status === "fulfilled") return setState({ status: "ready", me: me.value, setup: setup.value });
    const reason = me.status === "rejected" ? me.reason : undefined;
    const problem = !error && reason instanceof ApiError && reason.status !== 401 ? reason.message : undefined;
    setState({ status: "anonymous", setup: setup.value, error, problem });
  }, []);

  useEffect(() => {
    load(signInError);
  }, [load]);

  const ready = state.status === "ready";
  useEffect(() => {
    if (!ready) return;
    const onUnauthorized = () => load();
    window.addEventListener("r2-lens:unauthorized", onUnauthorized);
    return () => window.removeEventListener("r2-lens:unauthorized", onUnauthorized);
  }, [ready, load]);

  if (state.status === "loading") return loader;
  if (state.status === "unreachable") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Empty
          icon={<WarningCircleIcon size={48} className="text-kumo-danger" />}
          title="R2 Lens is not responding"
          description={state.message}
          contents={
            <Button icon={ArrowClockwiseIcon} onClick={() => load()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }
  if (state.status === "setup") {
    const { setup } = state;
    return (
      <Suspense fallback={loader}>
        <Setup
          {...setup}
          onBack={state.fromConfigure ? () => setState({ status: "configure", setup }) : undefined}
        />
      </Suspense>
    );
  }
  if (state.status === "configure") {
    return (
      <Suspense fallback={loader}>
        <Configure
          setup={state.setup}
          onBack={() => load()}
          onSetUpOAuth={(setup) => setState({ status: "setup", setup, fromConfigure: true })}
        />
      </Suspense>
    );
  }
  if (state.status === "anonymous") {
    const { setup } = state;
    return (
      <Login
        error={state.error}
        problem={state.problem}
        oauth={setup.oauth}
        tokenLogin={setup.tokenLogin}
        onSignedIn={() => load()}
        onConfigure={() => setState({ status: "configure", setup })}
      />
    );
  }
  const { setup } = state;
  return (
    <Shell
      me={state.me}
      setup={setup}
      onConfigure={setup ? () => setState({ status: "configure", setup }) : undefined}
      onSignIn={setup ? () => setState({ status: "anonymous", setup }) : undefined}
      onSignedOut={() => load()}
    />
  );
}
