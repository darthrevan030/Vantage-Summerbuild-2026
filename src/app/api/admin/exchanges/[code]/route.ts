import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: settings } = await supabase
    .from("user_settings")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (settings?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { code } = await params;
  const { active } = await req.json();

  if (typeof active !== "boolean") {
    return NextResponse.json({ error: "active must be a boolean" }, { status: 400 });
  }

  const { error } = await supabase
    .from("exchanges")
    .update({ active })
    .eq("code", code);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ code, active });
}
