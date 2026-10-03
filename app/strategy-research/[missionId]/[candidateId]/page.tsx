import CandidateDetailView from "@/components/strategy-research/CandidateDetailView";

export const dynamic = "force-dynamic";

export default async function CandidatePage({
    params,
}: {
    params: Promise<{ missionId: string; candidateId: string }>;
}) {
    const { missionId, candidateId } = await params;
    return <CandidateDetailView missionId={missionId} candidateId={candidateId} />;
}
