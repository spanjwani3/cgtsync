// ── Branded HTML email templates with inline CSS ──────────

const NAVY = "#1a2332";
const ACCENT = "#2563eb";
const ACCENT_HOVER = "#1d4ed8";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";

function baseLayout(title: string, body: string, footer: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background-color:#f8fafc;">
<tr><td style="padding:24px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<!-- Header bar -->
<tr><td style="background-color:${NAVY};padding:24px 32px;">
  <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">CGT-Sync</h1>
</td></tr>
<!-- Body -->
<tr><td style="padding:32px;">
${body}
</td></tr>
<!-- Footer -->
<tr><td style="padding:20px 32px;border-top:1px solid ${BORDER};background-color:#f8fafc;">
  <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.5;">${footer}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function ctaButton(label: string, url: string, color: string = ACCENT): string {
  return `<a href="${url}" style="display:inline-block;padding:12px 24px;background-color:${color};color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;line-height:1;">${label}</a>`;
}

// ── Confirmation Email ──────────────────────────────────────

export interface ConfirmationEmailParams {
  type: "BASELINE" | "CHANGE";
  title: string;
  items?: { label: string; value: string }[];
  ctaUrl: string;
  pmName?: string;
  orgName?: string;
  message?: string;
}

export function renderConfirmationEmail(params: ConfirmationEmailParams): string {
  const typeLabel = params.type === "BASELINE" ? "Baseline" : "Change Order";

  const itemsHtml = params.items?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;border:1px solid ${BORDER};border-radius:8px;overflow:hidden;">
${params.items.map((item, i) => `<tr style="background-color:${i % 2 === 0 ? "#f8fafc" : "#ffffff"};">
  <td style="padding:8px 12px;font-size:13px;color:${MUTED};width:40%;">${item.label}</td>
  <td style="padding:8px 12px;font-size:13px;color:${NAVY};font-weight:500;">${item.value}</td>
</tr>`).join("")}
</table>`
    : "";

  const messageHtml = params.message
    ? `<div style="margin:16px 0;padding:12px 16px;background-color:#f0f9ff;border-left:3px solid ${ACCENT};border-radius:0 8px 8px 0;">
  <p style="margin:0;font-size:13px;color:${NAVY};">${params.message}</p>
</div>`
    : "";

  const body = `
<h2 style="margin:0 0 8px;font-size:18px;color:${NAVY};">${typeLabel} Confirmation Request</h2>
<p style="margin:0 0 16px;font-size:14px;color:${MUTED};line-height:1.5;">
  ${params.pmName ? `${params.pmName} has` : "You have been"} sent you a ${typeLabel.toLowerCase()} for review and confirmation.
</p>
<div style="padding:16px;background-color:#f8fafc;border-radius:8px;border:1px solid ${BORDER};margin-bottom:16px;">
  <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};font-weight:600;">${typeLabel}</p>
  <p style="margin:4px 0 0;font-size:16px;font-weight:600;color:${NAVY};">${params.title}</p>
</div>
${itemsHtml}
${messageHtml}
<p style="margin:24px 0 16px;">
  ${ctaButton("Review & Confirm", params.ctaUrl)}
</p>
<p style="margin:0;font-size:12px;color:${MUTED};">This link expires in 48 hours. Click to review the details and approve or decline.</p>`;

  return baseLayout(
    `${typeLabel} Confirmation — CGT-Sync`,
    body,
    params.orgName
      ? `Sent via CGT-Sync on behalf of ${params.orgName}. This is an automated message.`
      : "Sent via CGT-Sync. This is an automated message."
  );
}

// ── Payment Reminder Email ──────────────────────────────────

export interface PaymentReminderEmailParams {
  invoiceNumber: string;
  amount: string;
  currency: string;
  dueDate: string;
  daysPastDue: number;
  tier: number;
  reminderCount: number;
  programName: string;
  orgName?: string;
}

export function renderPaymentReminderEmail(params: PaymentReminderEmailParams): string {
  const isOverdue = params.daysPastDue > 0;
  const urgencyColor = params.tier >= 3 ? "#dc2626" : params.tier >= 2 ? "#d97706" : ACCENT;
  const urgencyLabel = params.tier >= 3
    ? "Urgent: Significantly Past Due"
    : params.tier >= 2
    ? "Past Due Notice"
    : "Upcoming Payment Reminder";

  const body = `
<div style="padding:12px 16px;background-color:${params.tier >= 3 ? "#fef2f2" : params.tier >= 2 ? "#fffbeb" : "#f0f9ff"};border-left:4px solid ${urgencyColor};border-radius:0 8px 8px 0;margin-bottom:20px;">
  <p style="margin:0;font-size:14px;font-weight:600;color:${urgencyColor};">${urgencyLabel}</p>
</div>
<h2 style="margin:0 0 8px;font-size:18px;color:${NAVY};">Invoice ${params.invoiceNumber}</h2>
<p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.5;">
  Program: ${params.programName}
</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;border:1px solid ${BORDER};border-radius:8px;overflow:hidden;">
  <tr style="background-color:#f8fafc;">
    <td style="padding:10px 14px;font-size:13px;color:${MUTED};">Amount Due</td>
    <td style="padding:10px 14px;font-size:15px;font-weight:700;color:${NAVY};text-align:right;">${params.currency} ${params.amount}</td>
  </tr>
  <tr>
    <td style="padding:10px 14px;font-size:13px;color:${MUTED};">Due Date</td>
    <td style="padding:10px 14px;font-size:13px;font-weight:500;color:${isOverdue ? urgencyColor : NAVY};text-align:right;">${params.dueDate}${isOverdue ? ` (${params.daysPastDue} days past due)` : ""}</td>
  </tr>
  <tr style="background-color:#f8fafc;">
    <td style="padding:10px 14px;font-size:13px;color:${MUTED};">Reminder</td>
    <td style="padding:10px 14px;font-size:13px;color:${MUTED};text-align:right;">#${params.reminderCount}</td>
  </tr>
</table>
<p style="margin:0;font-size:13px;color:${MUTED};line-height:1.5;">
  Please arrange payment at your earliest convenience. If payment has already been made, please disregard this notice.
</p>`;

  return baseLayout(
    `Payment Reminder — Invoice ${params.invoiceNumber}`,
    body,
    params.orgName
      ? `Sent via CGT-Sync on behalf of ${params.orgName}. This is an automated reminder.`
      : "Sent via CGT-Sync. This is an automated reminder."
  );
}

// ── Dispute Delivery Email ──────────────────────────────────

export interface DisputeDeliveryEmailParams {
  programName: string;
  invoiceNumber: string;
  disputeAmount: string;
  currency: string;
  downloadUrl: string;
  pmName?: string;
  message?: string;
  orgName?: string;
}

export function renderDisputeDeliveryEmail(params: DisputeDeliveryEmailParams): string {
  const messageHtml = params.message
    ? `<div style="margin:16px 0;padding:12px 16px;background-color:#f0f9ff;border-left:3px solid ${ACCENT};border-radius:0 8px 8px 0;">
  <p style="margin:0;font-size:13px;color:${NAVY};">${params.message}</p>
</div>`
    : "";

  const body = `
<h2 style="margin:0 0 8px;font-size:18px;color:${NAVY};">Dispute Packet Delivered</h2>
<p style="margin:0 0 16px;font-size:14px;color:${MUTED};line-height:1.5;">
  ${params.pmName ?? "Your program manager"} has sent a forensic dispute packet for your review.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;border:1px solid ${BORDER};border-radius:8px;overflow:hidden;">
  <tr style="background-color:#f8fafc;">
    <td style="padding:10px 14px;font-size:13px;color:${MUTED};">Program</td>
    <td style="padding:10px 14px;font-size:13px;font-weight:500;color:${NAVY};text-align:right;">${params.programName}</td>
  </tr>
  <tr>
    <td style="padding:10px 14px;font-size:13px;color:${MUTED};">Invoice</td>
    <td style="padding:10px 14px;font-size:13px;font-weight:500;color:${NAVY};text-align:right;">${params.invoiceNumber}</td>
  </tr>
  <tr style="background-color:#f8fafc;">
    <td style="padding:10px 14px;font-size:13px;color:${MUTED};">Disputed Amount</td>
    <td style="padding:10px 14px;font-size:15px;font-weight:700;color:#dc2626;text-align:right;">${params.currency} ${params.disputeAmount}</td>
  </tr>
</table>
${messageHtml}
<p style="margin:24px 0 16px;">
  ${ctaButton("Download Dispute Pack (PDF)", params.downloadUrl)}
</p>
<p style="margin:0;font-size:12px;color:${MUTED};">This download link expires in 24 hours. The document is confidential.</p>`;

  return baseLayout(
    `Dispute Packet — Invoice ${params.invoiceNumber}`,
    body,
    params.orgName
      ? `Sent via CGT-Sync on behalf of ${params.orgName}. Confidential.`
      : "Sent via CGT-Sync. Confidential."
  );
}

// ── Follow-Up Reminder Email ────────────────────────────────

export interface FollowUpEmailParams {
  type: "BASELINE" | "CHANGE";
  title: string;
  originalSentDate: string;
  ctaUrl: string;
  orgName?: string;
}

export function renderFollowUpEmail(params: FollowUpEmailParams): string {
  const typeLabel = params.type === "BASELINE" ? "Baseline" : "Change Order";

  const body = `
<h2 style="margin:0 0 8px;font-size:18px;color:${NAVY};">Reminder: ${typeLabel} Awaiting Confirmation</h2>
<p style="margin:0 0 16px;font-size:14px;color:${MUTED};line-height:1.5;">
  A confirmation request was sent on ${params.originalSentDate} and is still pending your review.
</p>
<div style="padding:16px;background-color:#fffbeb;border-radius:8px;border:1px solid #fde68a;margin-bottom:20px;">
  <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#92400e;font-weight:600;">${typeLabel}</p>
  <p style="margin:4px 0 0;font-size:16px;font-weight:600;color:${NAVY};">${params.title}</p>
</div>
<p style="margin:20px 0 16px;">
  ${ctaButton("Review & Confirm", params.ctaUrl, ACCENT_HOVER)}
</p>
<p style="margin:0;font-size:12px;color:${MUTED};">If you have already responded, please disregard this reminder.</p>`;

  return baseLayout(
    `Reminder: ${typeLabel} Confirmation — CGT-Sync`,
    body,
    params.orgName
      ? `Sent via CGT-Sync on behalf of ${params.orgName}. This is an automated follow-up.`
      : "Sent via CGT-Sync. This is an automated follow-up."
  );
}

// ── Scope Alert Notification Email ──────────────────────────

export interface ScopeAlertEmailParams {
  programName: string;
  meetingTitle?: string;
  alertCount: number;
  alerts: { title: string; confidence: string; recommendedAction: string }[];
  ctaUrl: string;
  orgName?: string;
}

export function renderScopeAlertEmail(params: ScopeAlertEmailParams): string {
  const WARNING = "#d97706";

  const alertRows = params.alerts
    .slice(0, 5)
    .map(
      (a) =>
        `<tr>
  <td style="padding:8px 12px;font-size:13px;color:${NAVY};font-weight:500;">${a.title}</td>
  <td style="padding:8px 12px;font-size:13px;color:${a.confidence === "HIGH" ? "#dc2626" : a.confidence === "MEDIUM" ? WARNING : ACCENT};font-weight:600;text-align:center;">${a.confidence}</td>
  <td style="padding:8px 12px;font-size:12px;color:${MUTED};text-align:right;">${a.recommendedAction.replace(/_/g, " ")}</td>
</tr>`,
    )
    .join("");

  const moreText =
    params.alertCount > 5
      ? `<p style="margin:8px 0 0;font-size:12px;color:${MUTED};">+ ${params.alertCount - 5} more alert(s)</p>`
      : "";

  const meetingLabel = params.meetingTitle ?? "meeting transcript";

  const body = `
<div style="padding:12px 16px;background-color:#fffbeb;border-left:4px solid ${WARNING};border-radius:0 8px 8px 0;margin-bottom:20px;">
  <p style="margin:0;font-size:14px;font-weight:600;color:${WARNING};">${params.alertCount} Scope Flag${params.alertCount !== 1 ? "s" : ""} Detected</p>
</div>
<h2 style="margin:0 0 8px;font-size:18px;color:${NAVY};">Scope Analysis Results</h2>
<p style="margin:0 0 16px;font-size:14px;color:${MUTED};line-height:1.5;">
  Analysis of <strong>${meetingLabel}</strong> for program <strong>${params.programName}</strong> found potential out-of-scope items that may require change orders.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 8px;border:1px solid ${BORDER};border-radius:8px;overflow:hidden;">
  <tr style="background-color:#f8fafc;">
    <td style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};font-weight:600;">Flag</td>
    <td style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};font-weight:600;text-align:center;">Confidence</td>
    <td style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};font-weight:600;text-align:right;">Action</td>
  </tr>
  ${alertRows}
</table>
${moreText}
<p style="margin:24px 0 16px;">
  ${ctaButton("Review Scope Alerts", params.ctaUrl)}
</p>
<p style="margin:0;font-size:12px;color:${MUTED};">Review and resolve these alerts to keep your program's change management up to date.</p>`;

  return baseLayout(
    `${params.alertCount} Scope Flag${params.alertCount !== 1 ? "s" : ""} — ${params.programName}`,
    body,
    params.orgName
      ? `Sent via CGT-Sync on behalf of ${params.orgName}. This is an automated notification.`
      : "Sent via CGT-Sync. This is an automated notification.",
  );
}

// ── Ingest Confirmation Email ───────────────────────────────

export interface IngestConfirmationEmailParams {
  subject: string;
  detectedType: string;
  programName: string;
  orgName?: string;
}

export function renderIngestConfirmationEmail(params: IngestConfirmationEmailParams): string {
  const typeLabel = params.detectedType === "UNKNOWN" ? "unclassified content" : params.detectedType.toLowerCase().replace(/_/g, " ");

  const body = `
<h2 style="margin:0 0 8px;font-size:18px;color:${NAVY};">Email Received</h2>
<p style="margin:0 0 16px;font-size:14px;color:${MUTED};line-height:1.5;">
  We received your email <strong>"${params.subject}"</strong> and classified it as <strong>${typeLabel}</strong>.
  It is being processed for program <strong>${params.programName}</strong>.
</p>
<p style="margin:0;font-size:13px;color:${MUTED};line-height:1.5;">
  ${params.detectedType === "UNKNOWN" ? "A program manager will review and classify this content manually." : "You will be notified if any action items or scope alerts are generated."}
</p>`;

  return baseLayout(
    `Email Received — ${params.programName}`,
    body,
    params.orgName
      ? `Sent via CGT-Sync on behalf of ${params.orgName}. This is an automated confirmation.`
      : "Sent via CGT-Sync. This is an automated confirmation.",
  );
}

// ── Welcome Email (tenant onboarding) ───────────────────────

export interface WelcomeEmailParams {
  recipientEmail: string;
  orgName: string;
  programName: string;
  loginUrl: string;
  magicLink: string;
  tempPassword: string;
}

export function renderWelcomeEmail(params: WelcomeEmailParams): string {
  const body = `
<h2 style="margin:0 0 8px;font-size:18px;color:${NAVY};">Welcome to CGT-Sync</h2>
<p style="margin:0 0 16px;font-size:14px;color:${MUTED};line-height:1.5;">
  An admin account has been created for you on <strong>${params.orgName}</strong>'s CGT-Sync workspace
  for the program <strong>${params.programName}</strong>. CGT-Sync is the change-control and
  reconciliation platform for your CDMO program.
</p>
<p style="margin:24px 0 8px;">
  ${ctaButton("Sign in with one click", params.magicLink)}
</p>
<p style="margin:0 0 24px;font-size:12px;color:${MUTED};">This one-click link expires in 48 hours.</p>

<div style="margin:0 0 24px;padding:16px;background-color:#f8fafc;border:1px solid ${BORDER};border-radius:8px;">
  <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};font-weight:600;">If the one-click link expires</p>
  <p style="margin:0 0 4px;font-size:13px;color:${NAVY};">Sign in at <a href="${params.loginUrl}" style="color:${ACCENT};text-decoration:none;">${params.loginUrl}</a></p>
  <p style="margin:0 0 4px;font-size:13px;color:${NAVY};">Email: <span style="font-family:monospace;">${params.recipientEmail}</span></p>
  <p style="margin:0;font-size:13px;color:${NAVY};">Temporary password: <span style="font-family:monospace;font-weight:600;">${params.tempPassword}</span></p>
  <p style="margin:8px 0 0;font-size:12px;color:${MUTED};">Please change this password from Settings after signing in.</p>
</div>

<p style="margin:0;font-size:12px;color:${MUTED};">If you did not expect this email, please contact your organization's administrator.</p>`;

  return baseLayout(
    `Welcome to CGT-Sync — ${params.orgName}`,
    body,
    `Sent via CGT-Sync on behalf of ${params.orgName}. This is an automated message.`,
  );
}
