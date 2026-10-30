import { Button, useSidebar } from "@cloudflare/kumo";
import { SidebarSimpleIcon } from "@phosphor-icons/react";
import { useEffect } from "react";

export function SidebarToggle() {
  const { isMobile, setOpenMobile } = useSidebar();
  if (!isMobile) return null;
  return (
    <Button
      variant="ghost"
      shape="square"
      icon={SidebarSimpleIcon}
      aria-label="Open bucket list"
      className="shrink-0"
      onClick={() => setOpenMobile(true)}
    />
  );
}

export function CloseSidebarOnNavigate({ location }: { location: string }) {
  const { isMobile, setOpenMobile } = useSidebar();
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [location]);
  return null;
}
