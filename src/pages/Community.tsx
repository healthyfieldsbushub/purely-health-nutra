import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SEOHead } from "@/components/seo/SEOHead";
import { toast } from "sonner";
import { Users, GraduationCap, Sprout, BrainCircuit, Handshake, Mail, Loader2 } from "lucide-react";

const ENQUIRY_CATEGORIES = [
  "Community Development",
  "School Education",
  "Agricultural Training",
  "Farmer Development",
  "AI & Technology",
  "Project Sponsorship",
  "Business Partnership",
  "Affiliate Partnership",
  "General Enquiry",
];

// Exact social URLs supplied by the business — do not substitute usernames.
const NETWORK_BUSINESSES = [
  { name: "African Heritage Marketplace", desc: "Africa's cultural commerce platform.", fb: "https://web.facebook.com/profile.php?id=61594862187424" },
  { name: "Business OS Pro", desc: "AI CRM & business automation platform.", fb: "https://web.facebook.com/profile.php?id=61594693144944" },
  { name: "DFSA Members Network", desc: "Dragon Fruit South Africa grower network.", fb: "https://web.facebook.com/profile.php?id=61563159332764" },
  { name: "Dragon Fruit Worldwide South Africa Plant Supply", desc: "Dragon fruit plant supply across South Africa.", fb: "https://web.facebook.com/profile.php?id=61563501713802" },
  { name: "GradeMaster AI Tutor Africa", desc: "AI tutoring for African learners.", fb: "https://web.facebook.com/GradeMasterAITutorAfrica/", ig: "https://www.instagram.com/grademasteraitutorafrica/" },
  { name: "Living Culture Health", desc: "Fermented foods & gut-health living cultures.", fb: "https://web.facebook.com/profile.php?id=61595415033229", ig: "https://www.instagram.com/livingculturehealth.company/" },
  { name: "Market Place Hub SADC & UAE", desc: "Cross-border marketplace connecting SADC and UAE.", fb: "https://web.facebook.com/marketplacehub.africa/", ig: "https://www.instagram.com/marketplacehub.company/" },
  { name: "PixelPerfect AI", desc: "AI creative & media studio.", fb: "https://web.facebook.com/profile.php?id=61562823160217" },
  { name: "PocketSchoolPro", desc: "Digital learning tools for schools.", fb: "https://web.facebook.com/PocketSchoolPro/" },
  { name: "ProAgri-SA CRM Company", desc: "Agricultural CRM & farm administration software.", fb: "https://web.facebook.com/proagrisa/", ig: "https://www.instagram.com/proagrisa/" },
  { name: "ProAgriSA Education – Technical Schools", desc: "Technical and agricultural education programmes.", fb: "https://web.facebook.com/profile.php?id=61563974604325" },
  { name: "ProAgriSA SA News Today", desc: "Agricultural news and farmer updates in English.", fb: "https://web.facebook.com/profile.php?id=61560748018060" },
  { name: "ProAgriSA SA Nuus Vandag", desc: "Landbou-nuus en boer-inligting in Afrikaans.", fb: "https://web.facebook.com/profile.php?id=61560488964068" },
  { name: "ProAgriSA Spirulina & Chlorella Africa", desc: "Algae cultivation knowledge for Africa.", fb: "https://web.facebook.com/profile.php?id=61564838022257" },
  { name: "ProAgriSA Wonderful Dragon Fruit Botswana", desc: "Dragon fruit farmer development in Botswana.", fb: "https://web.facebook.com/profile.php?id=61589209614070" },
  { name: "ProAgriSA Wonderful Dragon Fruit DFSA", desc: "Dragon Fruit South Africa flagship page.", fb: "https://web.facebook.com/profile.php?id=61571339863052" },
  { name: "ProAgriSA Wonderful Dragon Fruit Malawi", desc: "Dragon fruit farmer development in Malawi.", fb: "https://web.facebook.com/profile.php?id=61562992080499" },
  { name: "ProAgriSA Wonderful Dragon Fruit Mozambique", desc: "Dragon fruit farmer development in Mozambique.", fb: "https://web.facebook.com/profile.php?id=61560728786177" },
  { name: "ProAgriSA Wonderful Dragon Fruit Namibia", desc: "Dragon fruit farmer development in Namibia.", fb: "https://web.facebook.com/profile.php?id=61565301583319" },
  { name: "ProAgriSA Wonderful Dragon Fruit Zimbabwe", desc: "Dragon fruit farmer development in Zimbabwe.", fb: "https://web.facebook.com/profile.php?id=61564586858163" },
  { name: "Purely Health Nutra – Gut Health Probiotics South Africa", desc: "Live probiotic cultures, kefir, kombucha and natural health products.", fb: "https://web.facebook.com/profile.php?id=61566672006628", ig: "https://www.instagram.com/purelyhealthnutracom/" },
  { name: "StudentGPT Pro", desc: "AI study assistant for students.", fb: "https://web.facebook.com/profile.php?id=61594973151084" },
  { name: "WildCamp360", desc: "Outdoor education and conservation experiences.", fb: "https://web.facebook.com/profile.php?id=61593467158008", ig: "https://www.instagram.com/wildcamp360/" },
];

const FacebookIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z"/></svg>
);
const InstagramIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2Zm0 2.9A6.9 6.9 0 1 0 12 18.9 6.9 6.9 0 0 0 12 5.1Zm0 11.4a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm7.2-11.7a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0Z"/></svg>
);

export default function Community() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) { window.scrollTo({ top: 0 }); return; }
    const el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);
  const [form, setForm] = useState({
    full_name: "", organisation: "", email: "", phone: "", country: "", category: "General Enquiry",
    project_name: "", project_description: "", proposed_partnership: "", available_resources: "", message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim() || !form.email.trim() || !/.+@.+\..+/.test(form.email)) {
      toast.error("Please enter your full name and a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/functions/partnership-enquiry", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const j = await r.json();
      const data = j.data ?? j;
      if (data.ok) { setSubmitted(true); toast.success(data.message); }
      else toast.error(data.error || "Could not send the enquiry — please try again.");
    } catch {
      toast.error("Network error — please try again.");
    } finally { setSubmitting(false); }
  };

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value });

  const jsonLd = [
    {
      "@context": "https://schema.org", "@type": "WebPage",
      name: "ProAgriSA Community Development & Projects",
      url: "https://purelyhealthnutra.company/community",
      description: "Agricultural community development, education, training, farmer outreach and AI innovation across South Africa and Africa.",
    },
    {
      "@context": "https://schema.org", "@type": "Organization",
      name: "ProAgriSA", url: "https://purelyhealthnutra.company/community",
      description: "Agricultural development, education and AI innovation network.",
    },
  ];

  return (
    <div className="min-h-screen">
      <SEOHead
        title="Community Development, Education & AI Innovation | ProAgriSA"
        description="Agricultural community development, school education, farmer training and AI innovation in South Africa and across Africa. Partner with ProAgriSA to grow communities and skills."
        canonical="https://purelyhealthnutra.company/community"
        jsonLd={jsonLd}
      />

      {/* Hero */}
      <section className="bg-[#0B3D2E] text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl text-center">
          <p className="text-[#4ADE80] font-semibold uppercase tracking-wider text-sm mb-3">ProAgriSA · Community & Innovation</p>
          <h1 className="font-serif text-4xl md:text-5xl font-bold mb-6">Growing Communities. Developing Skills. Advancing Agriculture Through Innovation.</h1>
          <p className="text-white/70 text-lg leading-relaxed">
            ProAgriSA brings together agricultural knowledge, community development, education, practical training and artificial
            intelligence to help create new opportunities for farmers, schools, young people and communities across Africa.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-8">
            <Button asChild size="lg" className="bg-[#4ADE80] text-[#0B3D2E] hover:bg-[#65e694]"><a href="#partnerships">Become a Project Partner</a></Button>
            <Button asChild size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10"><a href="#enquiry">Sponsor a Project</a></Button>
          </div>
        </div>
      </section>

      {/* Community development */}
      <section id="community" className="py-16">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex items-center gap-3 mb-4"><Sprout className="h-7 w-7 text-[#0B3D2E]" /><h2 className="text-3xl font-bold">Community Development & Agricultural Projects</h2></div>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            ProAgriSA aims to help communities identify agricultural opportunities, develop practical skills and explore sustainable
            farming activities — from rural community agricultural development and support for emerging farmers, to community food
            production initiatives, sustainable agricultural practices, soil health, water conservation and irrigation awareness,
            agricultural entrepreneurship, demonstration projects and community-based farming opportunities.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {["Rural community agricultural development", "Emerging and developing farmer support", "Community food production initiatives", "Sustainable agricultural practices", "Agricultural entrepreneurship", "Agricultural demonstration projects", "Community-based farming opportunities", "Soil health and sustainable production", "Water conservation and irrigation awareness", "Access to agricultural knowledge and resources"].map(item => (
              <div key={item} className="border rounded-lg p-4 text-sm font-medium flex items-start gap-2"><span className="text-[#4ADE80] mt-0.5">✓</span>{item}</div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground mt-6">
            Organisations, businesses and communities are welcome to approach ProAgriSA with proposed projects. Existing activities are
            shown above; new projects are proposed and depend on partnerships and sponsorship — we do not claim completed projects,
            funding or impact numbers that have not been verified.
          </p>
        </div>
      </section>

      {/* Education */}
      <section id="education" className="py-16 bg-muted/40">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex items-center gap-3 mb-4"><GraduationCap className="h-7 w-7 text-[#0B3D2E]" /><h2 className="text-3xl font-bold">Agricultural Education & School Outreach</h2></div>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            Agricultural education builds food security, employment, entrepreneurship and the next generation of agricultural
            development. ProAgriSA introduces agriculture into schools through school agricultural development programmes, school
            gardens and food production, practical crop production education, soil management and composting, sustainable agriculture,
            hydroponics and alternative farming, water conservation, modern farming technologies, agricultural entrepreneurship and an
            introduction to commercial agriculture and future agricultural career opportunities.
          </p>
          <Card>
            <CardContent className="pt-6 text-sm">
              Schools, teachers, educational institutions and community organisations are invited to enquire about potential
              collaborations — from a single school garden to a full school agricultural programme.
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Training */}
      <section id="training" className="py-16">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex items-center gap-3 mb-4"><Users className="h-7 w-7 text-[#0B3D2E]" /><h2 className="text-3xl font-bold">Agricultural Training & Skills Development</h2></div>
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <h3 className="font-semibold mb-3">Training areas</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {["Dragon fruit farming and commercial cultivation", "Crop production and farm management", "Soil improvement and biofertilizers", "Irrigation and water management", "Sustainable farming methods", "Agricultural business administration", "Agricultural entrepreneurship", "Digital farming", "AI-assisted agricultural management", "Farm record keeping", "Agricultural technology"].map(i => <li key={i}>• {i}</li>)}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-3">Delivery options</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {["Online education", "Practical demonstrations", "Agricultural workshops", "Community outreach", "School programmes", "Collaborative agricultural projects"].map(i => <li key={i}>• {i}</li>)}
              </ul>
              <p className="text-xs text-muted-foreground mt-4">Training offerings are described as educational programmes; formal accreditation or qualification status is not claimed unless verified.</p>
            </div>
          </div>
        </div>
      </section>

      {/* AI & DFSA */}
      <section id="ai" className="py-16 bg-[#0B3D2E] text-white">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex items-center gap-3 mb-4"><BrainCircuit className="h-7 w-7 text-[#4ADE80]" /><h2 className="text-3xl font-bold">ProAgriSA, DFSA & Artificial Intelligence in Agriculture</h2></div>
          <p className="text-white/70 mb-8 leading-relaxed">
            ProAgriSA and Dragon Fruit South Africa (DFSA) are embracing modern technology, AI and digital agriculture to make
            practical agricultural knowledge accessible to every farmer and learner.
          </p>
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="bg-white/5 border-white/10 text-white">
              <CardHeader className="pb-2"><CardTitle className="text-[#4ADE80] text-base">AI-Powered Agricultural Knowledge</CardTitle></CardHeader>
              <CardContent className="text-sm text-white/70">
                AI-assisted agricultural education, digital information platforms, AI tools that help farmers access knowledge,
                planning and decision-support tools, digital farm management and agricultural business development.
              </CardContent>
            </Card>
            <Card className="bg-white/5 border-white/10 text-white">
              <CardHeader className="pb-2"><CardTitle className="text-[#4ADE80] text-base">Dragon Fruit South Africa — DFSA</CardTitle></CardHeader>
              <CardContent className="text-sm text-white/70">
                Dragon fruit cultivation and farming education, cultivar knowledge, farmer development networks, digital agricultural
                resources, international knowledge sharing and AI-assisted educational tools for dragon fruit farmers.{" "}
                <Link to="/products?category=dragon-fruit-nursery-cultivars" className="underline text-[#4ADE80]">Explore the dragon fruit catalogue</Link>.
              </CardContent>
            </Card>
            <Card className="bg-white/5 border-white/10 text-white">
              <CardHeader className="pb-2"><CardTitle className="text-[#4ADE80] text-base">ProAgriSA Agricultural CRM</CardTitle></CardHeader>
              <CardContent className="text-sm text-white/70">
                An agricultural CRM platform in development to help agricultural businesses manage invoices and quotations, customers
                and suppliers, agricultural products, farm administration, business records, multiple company operations and
                AI-assisted administrative support — digital systems that help farmers improve business management.
              </CardContent>
            </Card>
          </div>
          <p className="text-xs text-white/50 mt-6">
            Our vision combines practical agricultural experience, traditional knowledge, education, digital technology and AI to help
            advance African agriculture. AI supports farmers and educators — it does not replace qualified agricultural professionals
            or guarantee farming outcomes.
          </p>
        </div>
      </section>

      {/* Partnerships */}
      <section id="partnerships" className="py-16">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex items-center gap-3 mb-4"><Handshake className="h-7 w-7 text-[#0B3D2E]" /><h2 className="text-3xl font-bold">Community Projects, Sponsors & Partnerships</h2></div>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            We invite corporate sponsors, agricultural businesses, educational institutions, development and community organisations,
            agricultural suppliers, technology companies, international development partners and individuals interested in agricultural
            development to collaborate on community agricultural projects, school programmes, youth development, farmer training,
            demonstrations, equipment and resource sponsorship, digital agriculture, AI and technology development, community food
            production and agricultural knowledge sharing.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Button asChild size="lg" className="bg-[#0B3D2E] hover:bg-[#0e4d3a] h-auto py-4"><a href="#enquiry">Become a Project Partner</a></Button>
            <Button asChild size="lg" variant="outline" className="border-[#0B3D2E] text-[#0B3D2E] hover:bg-muted h-auto py-4"><a href="#enquiry">Sponsor an Agricultural Development Project</a></Button>
            <Button asChild size="lg" className="bg-[#4ADE80] text-[#0B3D2E] hover:bg-[#65e694] h-auto py-4"><a href="#enquiry">Become an Educational & Community Partner</a></Button>
          </div>
        </div>
      </section>

      {/* Enquiry form */}
      <section id="enquiry" className="py-16 bg-muted/40">
        <div className="container mx-auto px-4 max-w-3xl">
          <h2 className="text-3xl font-bold mb-2">Partnership & Sponsorship Enquiry</h2>
          <p className="text-muted-foreground mb-6">Tell us about your organisation, project or sponsorship idea. Your enquiry goes straight to our administration and enquiry system.</p>
          {submitted ? (
            <Card><CardContent className="pt-6 text-center space-y-3">
              <Mail className="h-10 w-10 mx-auto text-[#4ADE80]" />
              <p className="font-semibold text-lg">Thank you — your enquiry has been received.</p>
              <p className="text-sm text-muted-foreground">We will review it and get back to you. If it is urgent, you are welcome to WhatsApp us on +27 83 447 4639.</p>
              <Button onClick={() => { setSubmitted(false); setForm({ ...form, project_name: "", project_description: "", message: "" }); }} variant="outline">Send another enquiry</Button>
            </CardContent></Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1"><Label>Full name *</Label><Input required value={form.full_name} onChange={set("full_name")} /></div>
                  <div className="space-y-1"><Label>Organisation or company</Label><Input value={form.organisation} onChange={set("organisation")} /></div>
                  <div className="space-y-1"><Label>Email address *</Label><Input required type="email" value={form.email} onChange={set("email")} /></div>
                  <div className="space-y-1"><Label>WhatsApp or telephone number</Label><Input value={form.phone} onChange={set("phone")} placeholder="+27 ..." /></div>
                  <div className="space-y-1"><Label>Country</Label><Input value={form.country} onChange={set("country")} placeholder="South Africa" /></div>
                  <div className="space-y-1">
                    <Label>Enquiry category</Label>
                    <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ENQUIRY_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-2"><Label>Project name</Label><Input value={form.project_name} onChange={set("project_name")} /></div>
                  <div className="space-y-1 sm:col-span-2"><Label>Project description</Label><Textarea rows={4} value={form.project_description} onChange={set("project_description")} /></div>
                  <div className="space-y-1 sm:col-span-2"><Label>Proposed partnership or sponsorship</Label><Textarea rows={3} value={form.proposed_partnership} onChange={set("proposed_partnership")} /></div>
                  <div className="space-y-1 sm:col-span-2"><Label>Available resources</Label><Textarea rows={2} value={form.available_resources} onChange={set("available_resources")} /></div>
                  <div className="space-y-1 sm:col-span-2"><Label>Additional message</Label><Textarea rows={3} value={form.message} onChange={set("message")} /></div>
                  <div className="sm:col-span-2">
                    <Button type="submit" size="lg" disabled={submitting} className="w-full bg-[#0B3D2E] hover:bg-[#0e4d3a]">
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Send enquiry
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* Business network directory */}
      <section className="py-16">
        <div className="container mx-auto px-4 max-w-6xl">
          <h2 className="text-3xl font-bold mb-2">Our Business Network, Technology Platforms & Development Initiatives</h2>
          <p className="text-muted-foreground mb-8">
            The wider Healthy Fields Group and its affiliated businesses, associated initiatives, educational platforms and technology
            projects across Africa.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NETWORK_BUSINESSES.map(b => (
              <Card key={b.name} className="h-full">
                <CardContent className="pt-5 space-y-2">
                  <p className="font-semibold text-sm leading-snug">{b.name}</p>
                  <p className="text-xs text-muted-foreground">{b.desc}</p>
                  <div className="flex gap-3 pt-1">
                    <a href={b.fb} target="_blank" rel="noopener noreferrer" aria-label={`${b.name} on Facebook`} className="text-[#1877F2] hover:opacity-80"><FacebookIcon /></a>
                    {b.ig && <a href={b.ig} target="_blank" rel="noopener noreferrer" aria-label={`${b.name} on Instagram`} className="text-[#E1306C] hover:opacity-80"><InstagramIcon /></a>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
