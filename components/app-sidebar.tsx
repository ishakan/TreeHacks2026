"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";
import {
  Box,
  Boxes,
  FolderOpen,
  ImageUp,
  LayoutDashboard,
  Pencil,
  WandSparkles,
} from "lucide-react";

import SignOutButton from "@/components/sign-out-button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import Image from "next/image";

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  user: {
    name?: string | null;
    email?: string | null;
  };
};

type NavSubItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  active: (pathname: string) => boolean;
};

type NavItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  active: (pathname: string) => boolean;
  items?: NavSubItem[];
};

const navMain: NavItem[] = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: LayoutDashboard,
    active: (pathname: string) => pathname === "/dashboard",
  },
  {
    title: "Projects",
    url: "/projects",
    icon: FolderOpen,
    active: (pathname: string) => pathname.startsWith("/projects"),
  },
  {
    title: "Studio",
    url: "/studio",
    icon: Box,
    active: (pathname: string) => pathname.startsWith("/studio"),
  },
  {
    title: "Assets",
    url: "/assets",
    icon: Boxes,
    active: (pathname: string) => pathname.startsWith("/assets"),
    items: [
      {
        title: "Image to 3D",
        url: "/generate/image-to-3d",
        icon: ImageUp,
        active: (pathname: string) =>
          pathname.startsWith("/generate/image-to-3d"),
      },
      {
        title: "Text to 3D",
        url: "/generate/text-to-3d",
        icon: WandSparkles,
        active: (pathname: string) =>
          pathname.startsWith("/generate/text-to-3d"),
      },
      {
        title: "Asset editor",
        url: "/generate/asset-editor",
        icon: Pencil,
        active: (pathname: string) =>
          pathname.startsWith("/generate/asset-editor"),
      },
    ],
  },
];

// const navSecondary = [
//   { title: "Settings", url: "/dashboard", icon: Settings },
//   { title: "Help", url: "/dashboard", icon: HelpCircle },
// ];

function initials(name?: string | null) {
  if (!name) return "DO";
  const parts = name.trim().split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function AppSidebar({ user, ...props }: AppSidebarProps) {
  const pathname = usePathname();
  const { state } = useSidebar();

  return (
    <Sidebar variant="sidebar" collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Voxal">
              <Link
                href="/dashboard"
                className={`hover:opacity-80 text-xl font-semibold text-white flex justify-center items-center gap-1 ${state === "collapsed" ? "mt-2 w-12 h-12" : "w-fit h-14"}`}
              >
                <Image
                  src="/voxalLogoTransparent.png"
                  alt="Logo"
                  width={28}
                  height={28}
                />
                Voxal{" "}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navMain.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                    isActive={item.active(pathname)}
                  >
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.items?.length ? (
                    <SidebarMenuSub
                      className={cn(
                        "max-h-0 overflow-hidden opacity-0 pointer-events-none transition-[max-height,opacity] duration-200",
                        "group-hover/menu-item:max-h-40 group-hover/menu-item:opacity-100 group-hover/menu-item:pointer-events-auto",
                        "group-focus-within/menu-item:max-h-40 group-focus-within/menu-item:opacity-100 group-focus-within/menu-item:pointer-events-auto",
                        item.items.some((subItem) =>
                          subItem.active(pathname),
                        ) && "max-h-40 opacity-100 pointer-events-auto",
                      )}
                    >
                      {item.items.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={subItem.active(pathname)}
                          >
                            <Link href={subItem.url}>
                              <subItem.icon />
                              <span>{subItem.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* <SidebarGroup>
          <SidebarGroupLabel>AI Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navTools.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup> */}

        {/* <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {navSecondary.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup> */}
      </SidebarContent>

      <SidebarFooter>
        <div className="border-sidebar-border flex items-center gap-3 rounded-md border p-2">
          <div className="bg-muted flex size-8 items-center justify-center rounded-md text-xs font-semibold">
            {initials(user.name)}
          </div>
          <div className="min-w-0 flex-1 text-xs">
            <p className="truncate font-medium">{user.name ?? "Designer"}</p>
            <p className="text-muted-foreground truncate">{user.email ?? ""}</p>
          </div>
        </div>
        <SignOutButton variant="outline" size="sm" className="w-full" />
      </SidebarFooter>
    </Sidebar>
  );
}
