"use client";

import { useParams } from "next/navigation";
import { useSyncProgram } from "@/components/layout/useSyncProgram";
import ContactManager from "@/components/contacts/ContactManager";

export default function ContactsPage() {
  const { programId } = useParams<{ programId: string }>();
  useSyncProgram();

  return <ContactManager programId={programId} />;
}
