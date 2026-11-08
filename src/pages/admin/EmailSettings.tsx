import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Mail, Loader2, Send, Inbox, Sparkles } from "lucide-react";

interface EmailSettings {
  smtp_host: string; smtp_port: string; smtp_username: string; smtp_encryption: string;
  sender_name: string; sender_email: string; reply_to: string; default_admin_email: string; test_recipient: string;
  imap_host: string; imap_port: string; imap_username: string; imap_encryption: string;
}

const EMPTY: EmailSettings = {
  smtp_host: "", smtp_port: "465", smtp_username: "", smtp_encryption: "ssl",
  sender_name: "Purely Health Nutra", sender_email: "", reply_to: "", default_admin_email: "", test_recipient: "",
  imap_host: "", imap_port: "993", imap_username: "", imap_encryption: "ssl",
};

// Afrihost defaults to help the administrator fill this in correctly.
const AFRIHOST_HINT = "Afrihost: smtp host mail.yourdomain.co.za, SMTP port 465 (SSL) or 587 (STARTTLS); IMAP host same server, port 993 (SSL).";

export default function AdminEmailSettings() {
  const [settings, setSettings] = useState<EmailSettings>(EMPTY);
  const [smtpPassword, setSmtpPassword] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [hasSmtpPassword, setHasSmtpPassword] = useState(false);
  const [hasImapPassword, setHasImapPassword] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [smtpResult, setSmtpResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [imapResult, setImapResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const { data: inbox, refetch: refetchInbox } = useInboxQuery(setBusy);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/functions/email-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "get" }) });
      const j = await r.json();
      const s = j.data?.settings;
      if (s) {
        setSettings({ ...EMPTY, ...s });
        setHasSmtpPassword(Boolean(s.smtp_password_set));
        setHasImapPassword(Boolean(s.imap_password_set));
      }
    })();
  }, []);

  const call = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const payload: Record<string, unknown> = { action, ...extra };
      if (action === "save" || action.startsWith("test") || action === "send-test") {
        payload.settings = { ...settings, ...(smtpPassword ? { smtp_password: smtpPassword } : {}), ...(imapPassword ? { imap_password: imapPassword } : {}) };
      }
      const r = await fetch("/api/functions/email-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      const data = j.data ?? j;
      if (action === "save") {
        setHasSmtpPassword(Boolean(data.settings?.smtp_password_set));
        setHasImapPassword(Boolean(data.settings?.imap_password_set));
        setSmtpPassword(""); setImapPassword("");
        toast.success("Email settings saved — passwords stored server-side only");
      } else if (action === "test-smtp") setSmtpResult({ ok: data.ok, detail: data.detail });
      else if (action === "test-imap") setImapResult({ ok: data.ok, detail: data.detail });
      else if (action === "send-test") toast[data.ok ? "success" : "error"](data.detail);
    } catch (error: any) {
      toast.error(error.message || "Request failed");
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Email Configuration</h1>
        <p className="text-sm text-muted-foreground">{AFRIHOST_HINT} Passwords are stored server-side and never shown again or exposed to the browser.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Mail className="h-4 w-4" />SMTP (outgoing mail)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="SMTP server" value={settings.smtp_host} onChange={(v) => setSettings({ ...settings, smtp_host: v })} placeholder="mail.yourdomain.co.za" />
              <Field label="SMTP port" value={settings.smtp_port} onChange={(v) => setSettings({ ...settings, smtp_port: v })} placeholder="465" />
            </div>
            <Field label="SMTP username" value={settings.smtp_username} onChange={(v) => setSettings({ ...settings, smtp_username: v })} placeholder="orders@yourdomain.co.za" />
            <div className="space-y-1">
              <Label className="text-xs">SMTP password {hasSmtpPassword && <Badge variant="secondary" className="ml-1">saved</Badge>}</Label>
              <Input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} placeholder={hasSmtpPassword ? "Leave blank to keep the saved password" : "Enter password"} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Encryption</Label>
              <Select value={settings.smtp_encryption} onValueChange={(v) => setSettings({ ...settings, smtp_encryption: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ssl">SSL (port 465)</SelectItem><SelectItem value="starttls">STARTTLS (port 587)</SelectItem><SelectItem value="none">None (not recommended)</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sender name" value={settings.sender_name} onChange={(v) => setSettings({ ...settings, sender_name: v })} />
              <Field label="Sender email" value={settings.sender_email} onChange={(v) => setSettings({ ...settings, sender_email: v })} placeholder="orders@yourdomain.co.za" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Reply-to address" value={settings.reply_to} onChange={(v) => setSettings({ ...settings, reply_to: v })} />
              <Field label="Default admin email" value={settings.default_admin_email} onChange={(v) => setSettings({ ...settings, default_admin_email: v })} />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={() => call("save")} disabled={busy === "save"}>{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Save settings</Button>
              <Button variant="outline" onClick={() => call("test-smtp")} disabled={busy === "test-smtp"}>{busy === "test-smtp" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Test SMTP connection</Button>
              <Button variant="outline" onClick={() => call("send-test")} disabled={busy === "send-test"}><Send className="h-3 w-3 mr-1" />Send test email</Button>
            </div>
            {smtpResult && <p className={`text-xs ${smtpResult.ok ? "text-green-600" : "text-destructive"}`}>{smtpResult.ok ? "✓ " : "✗ "}{smtpResult.detail}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Inbox className="h-4 w-4" />IMAP (incoming inbox — for the AI assistant)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Incoming mail server" value={settings.imap_host} onChange={(v) => setSettings({ ...settings, imap_host: v })} placeholder="mail.yourdomain.co.za" />
              <Field label="IMAP port" value={settings.imap_port} onChange={(v) => setSettings({ ...settings, imap_port: v })} placeholder="993" />
            </div>
            <Field label="Email username" value={settings.imap_username} onChange={(v) => setSettings({ ...settings, imap_username: v })} placeholder="Same as SMTP username" />
            <div className="space-y-1">
              <Label className="text-xs">Email password {hasImapPassword && <Badge variant="secondary" className="ml-1">saved</Badge>}</Label>
              <Input type="password" value={imapPassword} onChange={(e) => setImapPassword(e.target.value)} placeholder={hasImapPassword ? "Leave blank to keep the saved password" : "Enter password"} />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={() => call("save")} disabled={busy === "save"}>{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Save settings</Button>
              <Button variant="outline" onClick={() => call("test-imap")} disabled={busy === "test-imap"}>{busy === "test-imap" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Test inbox connection</Button>
              <Button variant="outline" onClick={() => { refetchInbox(); }} disabled={busy === "inbox"}>{busy === "inbox" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Sync inbox now</Button>
            </div>
            {imapResult && <p className={`text-xs ${imapResult.ok ? "text-green-600" : "text-destructive"}`}>{imapResult.ok ? "✓ " : "✗ "}{imapResult.detail}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4" />Customer enquiries (latest emails)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>From</TableHead><TableHead>Subject</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {(inbox?.messages || []).map((m: any) => <InboxRow key={m.uid} message={m} setBusy={setBusy} />)}
              {!inbox?.messages?.length && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">{inbox?.error || "No emails loaded yet — configure IMAP and sync."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function useInboxQuery(setBusy: (v: string | null) => void) {
  const [inbox, setInbox] = useState<any>(null);
  const refetch = async () => {
    setBusy("inbox");
    try {
      const r = await fetch("/api/functions/email-inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list", limit: 10 }) });
      const j = await r.json();
      setInbox(j.data ?? j);
    } finally { setBusy(null); }
  };
  return { data: inbox, refetch };
}

function InboxRow({ message, setBusy }: { message: any; setBusy: (v: string | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [isDrafting, setIsDrafting] = useState(false);
  const generateDraft = async () => {
    setIsDrafting(true); setBusy("draft");
    try {
      const r = await fetch("/api/functions/email-inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft-reply", from: message.from, subject: message.subject, body: message.body || message.subject }) });
      const j = await r.json();
      const data = j.data ?? j;
      setDraft(data.draft || data.error || "Could not generate a draft");
    } finally { setIsDrafting(false); setBusy(null); }
  };
  return (
    <TableRow>
      <TableCell className="text-xs">{new Date(message.date).toLocaleString("en-ZA")}</TableCell>
      <TableCell className="text-xs">{message.from_name || message.from}</TableCell>
      <TableCell className="text-xs">{message.subject}</TableCell>
      <TableCell>
        <Button size="sm" variant="outline" onClick={generateDraft} disabled={isDrafting}>
          {isDrafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}AI draft
        </Button>
        {draft && (
          <div className="mt-2 space-y-1">
            <Textarea readOnly value={draft} rows={4} className="text-xs" />
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(draft).then(() => toast.success("Draft copied — review and send from your mail client"))}>Copy draft</Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="text-sm" />
    </div>
  );
}
