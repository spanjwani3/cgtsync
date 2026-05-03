"use client";

import Sidebar from "./Sidebar";
import { useProgramContext } from "./ProgramContext";

interface Props {
  orgName: string;
  userEmail: string;
  userName?: string;
  isOrgAdmin?: boolean;
  logoUrl?: string | null;
  accentColor?: string | null;
}

export default function SidebarWithContext({
  orgName,
  userEmail,
  userName,
  isOrgAdmin,
  logoUrl,
  accentColor,
}: Props) {
  const { currentProgram } = useProgramContext();
  return (
    <Sidebar
      orgName={orgName}
      userEmail={userEmail}
      userName={userName}
      isOrgAdmin={isOrgAdmin}
      logoUrl={logoUrl}
      accentColor={accentColor}
      currentProgram={currentProgram}
    />
  );
}
