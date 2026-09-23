import { NextResponse } from "next/server";
import { channelStatuses } from "@/lib/growth/channels/registry";

export async function GET() {
    return NextResponse.json(channelStatuses());
}
