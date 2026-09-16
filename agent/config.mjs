// Configuration for the LinkedIn content agent.
//
// Everything the agent needs to know about *what* to post lives here. Secrets
// (API keys, LinkedIn token) come from the environment, never this file.

export const config = {
  // Claude model used to write posts. Opus 5 is the strongest general model.
  model: process.env.CLAUDE_MODEL || "claude-opus-5",

  // The domain the posts are framed for. The agent applies each theory to
  // this world, the way the author's real posts do.
  domain: [
    "You are Chris Harada, a leader in the medical device and medical",
    "aesthetics industry: high-touch B2B service, field service, device",
    "installs and training, customer experience, retention, and operational",
    "and service excellence. Frame ideas through this world by default.",
  ].join(" "),

  // The persona/voice — modelled on the author's real LinkedIn posts.
  voice: [
    "You write LinkedIn thought-leadership posts in a specific, consistent",
    "voice. Every post takes ONE named concept or theory, defines it plainly,",
    "and applies it to the medical device / aesthetics service world to land a",
    "motivating, practical lesson.",
    "",
    "Follow this structure closely:",
    "1. A titled headline as the first line, e.g. 'The [Concept]: How ...' or",
    "   'The [Concept] in [context]' or 'The [X] Rule/Power/Danger of ...'.",
    "2. A short hook that frames it in the industry ('In aesthetics, ...',",
    "   'In the medical device industry, ...') and raises a tension or question.",
    "3. Name and define the concept in one plain-language line:",
    "   'This is the [Theory]. In plain terms, [definition].'",
    "4. Make it concrete: a short bulleted list using '•' bullets, OR parallel",
    "   'If X? Then Y.' lines. Show the idea in real service/field situations.",
    "5. Turn it: contrast the opposite, then stack a few punchy one-line",
    "   sentences for rhythm.",
    "6. A 'What if ...' rhetorical line that lifts the reader's ambition.",
    "7. A motivating close of two short parallel lines",
    "   (e.g. 'Standards create consistency. Judgment creates loyalty.').",
    "8. End with a genuine engagement question, usually to 'your team'.",
    "",
    "Style: confident, warm, direct. Short one-line paragraphs with lots of",
    "white space. No emoji, or at most one, used rarely.",
    "Around 150-200 words.",
    "",
    "PUNCTUATION — strict rules:",
    "- NEVER use em dashes (—) or en dashes (–). Not once. Use a period, a",
    "  comma, a colon, or the word 'and' instead. When two clauses want a dash,",
    "  make them two short sentences.",
    "- Use plain hyphens only inside real compound words (e.g. high-touch).",
    "",
    "AVOID AI-sounding jargon and filler. Do not use words/phrases like: delve,",
    "dive in, unlock, leverage, elevate, harness, supercharge, game-changer,",
    "tapestry, testament, navigate the landscape, in today's fast-paced world,",
    "at the end of the day, when it comes to, it's not just X, it's Y, the",
    "power of, realm, robust, seamless, synergy, paradigm shift, needle-mover.",
    "Write like a real practitioner talking to peers, in concrete, plain words.",
  ].join("\n"),

  // The heart of the agent: real theories the posts teach and apply. Each run
  // picks one (by rotation or at random) and Claude writes a motivational post
  // that explains it and turns it into a practical takeaway. Grouped by the
  // category, which also drives the framing and hashtags.
  theories: [
    // Concept Series (curated — runs first). Behavioral and service concepts
    // applied to medical device / aesthetics field service. Each carries an
    // `angle` that steers the post toward the approved take.
    { name: "The Peak-End Rule", category: "Customer Experience",
      angle: "Clients remember the best moment and the goodbye, not the average. The last five minutes of a service call matter most." },
    { name: "The Service Recovery Paradox", category: "Customer Experience",
      angle: "A complaint handled brilliantly builds more loyalty than a flawless record. Your worst service days are your best retention chances." },
    { name: "Goodhart's Law", category: "Operational Excellence",
      angle: "When first-time-fix becomes a target, techs chase the number instead of the outcome. The metric stops telling the truth." },
    { name: "The Trust Equation", category: "Customer Relationships",
      angle: "Credibility plus reliability plus intimacy, divided by self-orientation. The rep who pushes the sale least often wins the account." },
    { name: "The Zeigarnik Effect", category: "Service Operations",
      angle: "An open ticket nags a clinic more than the repair itself. Closing the loop fast is retention, not admin." },
    { name: "Loss Aversion", category: "Behavioral Economics",
      angle: "Clinics fear downtime more than they crave new features. Sell uptime and protection, not just upgrades." },
    { name: "The Endowment Effect", category: "Behavioral Economics",
      angle: "Providers over-value the device and workflow they trained on. Use it to deepen loyalty, and respect it when introducing change." },
    { name: "Diffusion of Innovation", category: "Strategy",
      angle: "Every clinic adopts a new device differently. Early adopters and laggards need different support." },
    { name: "The IKEA Effect", category: "Customer Experience",
      angle: "People value what they help build. Involve providers in shaping their own workflow and they defend it." },
    { name: "Parkinson's Law", category: "Operations",
      angle: "Work expands to fill the time you give it. An install with no time box drifts; a tight one focuses." },
    { name: "The Pratfall Effect", category: "Trust and Communication",
      angle: "Admitting the one thing you cannot fix today builds more trust than pretending everything is fine." },
    { name: "The Dunning-Kruger Curve", category: "Training and Development",
      angle: "The most dangerous moment in provider training is right after they feel confident, before they are competent." },
    { name: "Chesterton's Fence", category: "Leadership and Process",
      angle: "Before you change a service process, learn why it exists. The annoying step may be load-bearing." },
    { name: "The Flywheel Effect", category: "Retention and Strategy",
      angle: "Retention compounds. One saved account funds the effort that saves the next." },
    { name: "Social Proof", category: "Marketing",
      angle: "One reference clinic outsells any spec sheet. Buyers trust peers over pitches." },
    { name: "The Reciprocity Principle", category: "Customer Relationships",
      angle: "The small unbilled favor creates an obligation that quietly shows up at renewal." },
    { name: "The Sunk Cost Fallacy", category: "Behavioral Economics",
      angle: "Clinics keep a device that no longer serves them because of what they already spent. Name it to move them forward." },
    { name: "The Availability Heuristic", category: "Brand and Customer Experience",
      angle: "Your last bad visit defines your whole brand in the customer's mind, no matter your averages." },
    { name: "The Kano Model", category: "Customer Experience",
      angle: "Some things delight a clinic, some are simply expected. Know the difference before you invest." },
    { name: "The Pygmalion Effect", category: "Leadership and Motivation",
      angle: "Providers and techs rise to the confidence you show them. Expectations shape performance." },

    // Management
    { name: "Administrative Management Theory (Henri Fayol)", category: "Management" },
    { name: "Bureaucratic Management Theory (Max Weber)", category: "Management" },
    { name: "Human Relations Theory (Elton Mayo)", category: "Management" },
    { name: "Systems Theory", category: "Management" },
    { name: "Contingency Theory", category: "Management" },
    { name: "Theory X and Theory Y (Douglas McGregor)", category: "Management" },
    { name: "Management by Objectives (Peter Drucker)", category: "Management" },
    { name: "Total Quality Management", category: "Management" },
    { name: "Lean Management", category: "Management" },

    // Motivation & Employees
    { name: "Maslow's Hierarchy of Needs", category: "Motivation" },
    { name: "Herzberg's Two-Factor Theory", category: "Motivation" },
    { name: "Vroom's Expectancy Theory", category: "Motivation" },
    { name: "Equity Theory (John Stacey Adams)", category: "Motivation" },
    { name: "Goal-Setting Theory (Locke and Latham)", category: "Motivation" },
    { name: "Self-Determination Theory", category: "Motivation" },
    { name: "Reinforcement Theory", category: "Motivation" },
    { name: "McClelland's Needs Theory", category: "Motivation" },

    // Leadership
    { name: "Trait Theory of Leadership", category: "Leadership" },
    { name: "Behavioral Leadership Theory", category: "Leadership" },
    { name: "Situational Leadership Theory", category: "Leadership" },
    { name: "Transformational Leadership Theory", category: "Leadership" },
    { name: "Transactional Leadership Theory", category: "Leadership" },
    { name: "Servant Leadership Theory", category: "Leadership" },
    { name: "Path-Goal Theory", category: "Leadership" },
    { name: "Leader-Member Exchange Theory", category: "Leadership" },

    // Strategy & Competition
    { name: "Porter's Five Forces", category: "Strategy" },
    { name: "Resource-Based View", category: "Strategy" },
    { name: "Dynamic Capabilities Theory", category: "Strategy" },
    { name: "Blue Ocean Strategy", category: "Strategy" },
    { name: "Competitive Advantage Theory", category: "Strategy" },
    { name: "Core Competency Theory", category: "Strategy" },
    { name: "Game Theory", category: "Strategy" },
    { name: "Strategic Fit Theory", category: "Strategy" },
    { name: "Disruptive Innovation Theory", category: "Strategy" },
    { name: "Ansoff Growth Matrix", category: "Strategy" },

    // Marketing & Consumer Behavior
    { name: "Marketing Mix Theory (4Ps and 7Ps)", category: "Marketing" },
    { name: "Market Segmentation Theory", category: "Marketing" },
    { name: "Consumer Decision-Making Theory", category: "Marketing" },
    { name: "AIDA Model", category: "Marketing" },
    { name: "Diffusion of Innovations (Everett Rogers)", category: "Marketing" },
    { name: "Brand Equity Theory", category: "Marketing" },
    { name: "Relationship Marketing Theory", category: "Marketing" },
    { name: "Customer Lifetime Value Theory", category: "Marketing" },
    { name: "Technology Acceptance Model", category: "Marketing" },

    // Organization & Operations
    { name: "Organizational Culture Theory (Edgar Schein)", category: "Organization" },
    { name: "Organizational Learning Theory", category: "Organization" },
    { name: "Institutional Theory", category: "Organization" },
    { name: "Agency Theory", category: "Organization" },
    { name: "Stakeholder Theory", category: "Organization" },
    { name: "Transaction Cost Economics", category: "Organization" },
    { name: "Supply Chain Management Theory", category: "Organization" },
    { name: "Theory of Constraints", category: "Organization" },
    { name: "Just-in-Time Theory", category: "Organization" },
    { name: "Six Sigma", category: "Organization" },

    // Entrepreneurship & Innovation
    { name: "Schumpeter's Innovation Theory", category: "Entrepreneurship" },
    { name: "Effectuation Theory", category: "Entrepreneurship" },
    { name: "Entrepreneurial Opportunity Theory", category: "Entrepreneurship" },
    { name: "Lean Startup Theory", category: "Entrepreneurship" },
    { name: "Creative Destruction", category: "Entrepreneurship" },
    { name: "Open Innovation Theory", category: "Entrepreneurship" },
    { name: "Business Model Innovation Theory", category: "Entrepreneurship" },

    // Finance & Economics
    { name: "Efficient Market Hypothesis", category: "Finance" },
    { name: "Modern Portfolio Theory", category: "Finance" },
    { name: "Capital Structure Theory", category: "Finance" },
    { name: "Modigliani-Miller Theorem", category: "Finance" },
    { name: "Prospect Theory", category: "Finance" },
    { name: "Principal-Agent Theory", category: "Finance" },
    { name: "Behavioral Finance Theory", category: "Finance" },
    { name: "Shareholder Value Theory", category: "Finance" },

    // Already published once. Placed last so the curated concept series above
    // runs first (rotation picks the entry after the last-posted one).
    { name: "Scientific Management Theory (Frederick Taylor)", category: "Management" },
  ],

  // Promotional posts about AI agents in the workplace, rotated in between the
  // concept posts (see ad cadence below). These are fixed, approved copy. Each
  // carries a verified article from a mainstream source; the runner appends the
  // link and hashtags when publishing.
  ads: [
    {
      id: "shift",
      includeLink: true,
      text: `AI Agents Are Quietly Rewriting the Cost of Doing Business

A few years ago, AI could answer a question. Now it can do the job.

The change is that agents don't just chat. They take an outcome and run it end to end: pull the data, draft the report, update the CRM, send the follow-up, and flag what needs a human.

Here is what that looks like in real terms. The weekly reporting a coordinator used to spend most of a day on now runs in minutes. Invoice follow-ups that slipped through the cracks get sent on time, every time. Inbox triage happens before anyone sits down.

The savings are not just headcount. It is the hours your best people get back to spend on customers instead of copy-paste.

The teams pulling ahead are not the ones with the most staff. They are the ones who stopped making people do work a machine can do.

If your company is looking to save money and drive efficiency, message me. Let's talk about building a small team of AI agents to take the repetitive work off your people's plates.

What is the one task your team dreads every week?`,
      article: {
        title: "McKinsey: The economic potential of generative AI",
        url: "https://www.mckinsey.com/capabilities/tech-and-ai/our-insights/the-economic-potential-of-generative-ai-the-next-productivity-frontier",
      },
      hashtags: ["#AIAgents", "#Automation", "#Efficiency", "#FutureOfWork", "#Productivity", "#OperationalExcellence", "#CostSavings", "#DigitalTransformation"],
    },
    {
      id: "proof",
      includeLink: false,
      text: `Here Is What an AI Agent Handled for a Team Last Month

People picture AI as a chatbot. The reality is closer to a tireless coordinator who works nights and weekends.

In one month, a single agent can:
• Draft and format the weekly reports, ready for review by 7am Monday.
• Chase every open invoice and log the responses.
• Keep the CRM clean so nobody sells to a lapsed account.
• Answer the same twelve customer questions your team answers a hundred times a week.

None of that is glamorous. All of it costs you real money when a person does it.

An agent does not call in sick, does not forget the follow-up, and does not need the task explained twice.

Your people did not train for years to copy numbers between spreadsheets. Give that work to an agent and give them back the work only a human can do.

If your company is looking to save money and drive efficiency, reach out. I help teams build a small crew of AI agents to automate the repetitive work.

Which of those four would free up your team the most?`,
      article: {
        title: "Harvard Business Review: Agentic AI Is Already Changing the Workforce",
        url: "https://hbr.org/2025/05/agentic-ai-is-already-changing-the-workforce",
      },
      hashtags: ["#AIAgents", "#Automation", "#WorkplaceEfficiency", "#Productivity", "#SmallBusiness", "#Operations", "#CostReduction", "#FutureOfWork"],
    },
    {
      id: "objection",
      includeLink: true,
      text: `AI Agents Are Not Here to Replace Your Team. They Are Here to Give Them Their Time Back.

The fear is that automation means fewer people. In practice, it means your people stop drowning in busywork.

Think about where your team's hours actually go. Data entry. Status updates. Following up on the follow-up. Rebuilding the same report every week. None of it is why you hired them.

An AI agent takes that layer off their plate. The coordinator becomes a problem solver. The rep spends the extra hour with a customer instead of updating a field. The manager sees the numbers without chasing them.

The cost of that busywork is easy to miss because it is spread across everyone. Add it up across a year and it is a full salary hiding in plain sight.

You do not need a bigger team. You need your current team pointed at work that matters.

If your company is looking to save money and drive efficiency, let's connect. I build small teams of AI agents that quietly handle the repetitive work so your people can do theirs.

Where would an extra five hours a week go on your team?`,
      article: {
        title: "Microsoft Work Trend Index: Agents, human agency, and the opportunity for every organization",
        url: "https://www.microsoft.com/en-us/worklab/work-trend-index/agents-human-agency-and-the-opportunity-for-every-organization",
      },
      hashtags: ["#AIAgents", "#Automation", "#Leadership", "#Efficiency", "#FutureOfWork", "#EmployeeExperience", "#Productivity", "#Operations"],
    },
    {
      id: "competitors",
      includeLink: false,
      text: `Your Competitors Are Automating the Boring Work. Are You?

The gap between companies is no longer who has the biggest team. It is who makes their team the most effective.

AI agents now handle the repetitive tasks that quietly eat your margin: reporting, follow-ups, data cleanup, scheduling, first-line customer questions. They run around the clock, they do not miss, and they cost a fraction of the hours they replace.

The result is simple. Lower cost per task, faster turnaround, and a team focused on the work that actually grows the business.

This is not the future. It is happening in workplaces right now, and the ones who move first are already pulling ahead.

If your company is looking to save money and drive efficiency, contact me. I help businesses build a small team of AI agents to automate the busywork and free their people to do more.

What would you automate first if you could?`,
      article: {
        title: "World Economic Forum: The Future of Jobs Report 2025",
        url: "https://www.weforum.org/publications/the-future-of-jobs-report-2025/digest/",
      },
      hashtags: ["#AIAgents", "#Automation", "#Efficiency", "#CostSavings", "#FutureOfWork", "#Productivity", "#DigitalTransformation", "#Business"],
    },
  ],

  // Ad cadence: one ad per this many concept posts (2 => an ad every 3rd post).
  theoriesPerAd: Number(process.env.THEORIES_PER_AD || 2),
  // Non-ad posts already made before ads were introduced, so the curated
  // concept series still runs first before ads start interleaving.
  adBaselineNonAd: Number(process.env.AD_BASELINE_NONAD || 2),

  // How the theory is chosen each run: "rotate" walks the list in order (using
  // the post history), "random" picks one at random.
  selection: process.env.TOPIC_SELECTION || "rotate",

  // Length guidance for the model, in words.
  targetWords: Number(process.env.TARGET_WORDS || 180),

  // How many previous posts to show the model so it doesn't repeat itself.
  historyContext: Number(process.env.HISTORY_CONTEXT || 8),

  // LinkedIn API version (YYYYMM). LinkedIn requires this header on the
  // versioned /rest endpoints. Bump it as LinkedIn releases new versions
  // (they age out roughly 12 months after release).
  linkedinApiVersion: process.env.LINKEDIN_API_VERSION || "202606",

  // Post visibility: PUBLIC or CONNECTIONS.
  visibility: process.env.LINKEDIN_VISIBILITY || "PUBLIC",

  // Video cadence: every Nth theory post goes out as a rendered explainer
  // video instead of plain text (3 => the 3rd, 6th, 9th ... theory post).
  // Ads are untouched, so the ad rhythm stays exactly as it was.
  theoriesPerVideo: Number(process.env.THEORIES_PER_VIDEO || 3),
  // Theory posts already made before video was introduced. The counter starts
  // from here so the first video lands `theoriesPerVideo` posts from now,
  // rather than retroactively counting the whole back catalogue.
  videoBaselineTheories: Number(process.env.VIDEO_BASELINE_THEORIES || 14),

  // How the explainer video is rendered. The video is silent by design:
  // LinkedIn autoplays muted, so the teaching has to live on screen. Colours are
  // plain hex without a leading '#', because that is what ffmpeg wants.
  video: {
    // 1:1 square. Desktop LinkedIn renders the feed video player at 1:1, so
    // anything taller (4:5, 9:16) is pillarboxed with hard black down both
    // sides. A square fills that player exactly. It gives up some feed height
    // on mobile, which is the trade: set VIDEO_HEIGHT=1350 for 4:5 if you would
    // rather have the mobile height and accept the desktop bars.
    width: Number(process.env.VIDEO_WIDTH || 1080),
    height: Number(process.env.VIDEO_HEIGHT || 1080),
    fps: Number(process.env.VIDEO_FPS || 30),

    // Warm near-black ground, warm off-white copy, one gold accent. `muted` is
    // for supporting lines, `dim` for a deliberately de-emphasised stat, `rule`
    // for dividers.
    // Pure black, deliberately. LinkedIn's feed player letterboxes any video
    // whose aspect does not match its container, and it pads with pure black.
    // A warm near-black ground made that padding read as a hard border around
    // the video; matching it exactly makes the padding invisible whatever
    // aspect the player decides to use. The warmth stays in the type colours.
    background: process.env.VIDEO_BG || "000000",
    foreground: process.env.VIDEO_FG || "F7F4EE",
    accent: process.env.VIDEO_ACCENT || "E8B44A",
    muted: process.env.VIDEO_MUTED || "8B857A",
    dim: process.env.VIDEO_DIM || "A39C92",
    rule: process.env.VIDEO_RULE || "302B26",

    // Shown once, on the opening frame.
    brand: process.env.VIDEO_BRAND || "Harada Insights",

    // Persistent watermark along the bottom of every frame. Empty disables it.
    // Kept quiet on purpose: it should be legible if you look for it and
    // ignorable if you are reading the copy.
    watermark: process.env.VIDEO_WATERMARK || "https://www.linkedin.com/in/kenzoharada",
    // Draw a small "in" badge before the text.
    watermarkBadge: process.env.VIDEO_WATERMARK_BADGE !== "false",

    // Inter, in two cuts: the tighter Display cut for headlines and numerals,
    // the text cut for supporting copy. First path that exists wins.
    fontDisplayCandidates: [
      process.env.VIDEO_FONT_DISPLAY,
      "/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf",
      "/usr/share/fonts/truetype/inter/InterDisplay-Bold.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
    fontRegularCandidates: [
      process.env.VIDEO_FONT_REGULAR,
      "/usr/share/fonts/opentype/inter/Inter-Regular.otf",
      "/usr/share/fonts/truetype/inter/Inter-Regular.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],

    // Copy is set flush left off this margin and anchored near the top of the
    // frame, so beats of different lengths all start on the same line.
    margin: Number(process.env.VIDEO_MARGIN || 84),
    topAnchor: Number(process.env.VIDEO_TOP_ANCHOR || 0.14),
    fadeSeconds: Number(process.env.VIDEO_FADE || 0.3),

    // Rendered files land here. Git-ignored: the MP4 is an artifact of the run.
    outDir: process.env.VIDEO_OUT_DIR || "out",
  },
};
