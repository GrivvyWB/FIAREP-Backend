export default function Ready() {
  return (
    <div className="grid-bg relative w-screen h-screen overflow-hidden font-body text-text">
      <div className="absolute left-[5vw] top-[5vh] h-[3vw] w-[3vw] bg-primary" />
      <div className="absolute right-[5vw] top-[5vh] text-right text-[1.5vw] font-semibold uppercase tracking-[0.12em] text-primary">FIAREP / 05</div>
      <div className="absolute left-[8vw] top-[12vh] w-[84vw]">
        <h2 className="max-w-[80vw] text-[4.1vw] font-bold leading-[1.08] tracking-[-0.035em] text-[#111111]">Complete and operational</h2>
        <div className="mt-[3.5vh] grid grid-cols-[1.2fr_0.8fr] gap-[3vw]">
          <div className="space-y-[1.8vh]">
            <div className="border-b border-[#DDE2E7] pb-[1.5vh] text-[2vw] font-medium leading-[1.32] text-[#334155]">Expo mobile app, Express/PostgreSQL API, and management website operate as one product</div>
            <div className="border-b border-[#DDE2E7] pb-[1.5vh] text-[2vw] font-medium leading-[1.32] text-[#334155]">Backend-only OpenAI integration and NYC Planning, HPD, and DOB data connections</div>
            <div className="border-b border-[#DDE2E7] pb-[1.5vh] text-[2vw] font-medium leading-[1.32] text-[#334155]">Authenticated management-site audit completed across all major routes</div>
            <div className="border-b border-[#DDE2E7] pb-[1.5vh] text-[2vw] font-medium leading-[1.32] text-[#334155]">Website and API typechecks pass; core role, notification, Calendar, photo, Team, and licensing defects resolved</div>
          </div>
          <div className="flex flex-col justify-between border border-primary bg-primary p-[2.6vw] text-white">
            <div>
              <div className="text-[1.5vw] font-bold uppercase tracking-[0.14em] text-[#DCE8F2]">Platform status</div>
              <div className="mt-[3vh] text-[4.5vw] font-bold leading-none tracking-[-0.05em]">Operational</div>
            </div>
            <p className="text-[2vw] font-medium leading-[1.42] text-white">Mobile, web, API, data, and access controls work together across FIAREP.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
