import { useEffect, useState } from "react";
import type { Jurisdiction } from "../../shared/types";

type Route = {
  accountId?: string;
  jurisdiction: Jurisdiction;
  bucket?: string;
  prefix: string;
};

function parseRoute(hash = location.hash): Route {
  const [accountId, jurisdiction, bucket, ...rest] = hash.replace(/^#\/?/, "").split("/");
  const parts = rest.map(decodeURIComponent);
  return {
    accountId: accountId ? decodeURIComponent(accountId) : undefined,
    jurisdiction: (jurisdiction as Jurisdiction) || "default",
    bucket: bucket ? decodeURIComponent(bucket) : undefined,
    prefix: parts.length && parts.some(Boolean) ? `${parts.filter(Boolean).join("/")}/` : "",
  };
}

export function href(route: Partial<Route> & { accountId: string }) {
  const segments = [route.accountId, route.jurisdiction ?? "default"];
  if (route.bucket) {
    segments.push(route.bucket, ...(route.prefix ?? "").split("/").filter(Boolean));
  }
  return `#/${segments.map(encodeURIComponent).join("/")}`;
}

export function navigate(route: Partial<Route> & { accountId: string }) {
  location.hash = href(route);
}

type NavigationLike = EventTarget & { canGoBack: boolean; canGoForward: boolean };

export function useHistoryNav() {
  const nav = (window as Window & { navigation?: NavigationLike }).navigation;
  const read = () => ({ canGoBack: nav?.canGoBack ?? true, canGoForward: nav?.canGoForward ?? true });
  const [state, setState] = useState(read);
  useEffect(() => {
    const onChange = () => setState(read());
    window.addEventListener("hashchange", onChange);
    nav?.addEventListener("currententrychange", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      nav?.removeEventListener("currententrychange", onChange);
    };
  }, []);
  return { ...state, back: () => history.back(), forward: () => history.forward() };
}

export function useRoute() {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
