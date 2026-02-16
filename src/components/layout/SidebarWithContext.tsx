"use client";

import Sidebar from "./Sidebar";
import { useProgramContext } from "./ProgramContext";

interface Props {
  orgName: string;
  userEmail: string;
  userName?: string;
}

export default function SidebarWithContext({ orgName, userEmail, userName }: Props) {
  const { currentProgram } = useProgramContext();
  return (
    <Sidebar
      orgName={orgName}
      userEmail={userEmail}
      userName={userName}
      currentProgram={currentProgram}
    />
  );
}
