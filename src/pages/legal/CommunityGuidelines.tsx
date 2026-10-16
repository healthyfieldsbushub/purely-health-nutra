import { LegalPage } from "@/components/legal/LegalPage";

const CommunityGuidelines = () => (
  <LegalPage
    title="Community Guidelines"
    slug="community-guidelines"
    description="The standards we expect from everyone posting reviews, listings or comments on Purely Health Nutra."
  >
    <p>
      These guidelines apply to reviews, business directory listings, comments and any other content you
      submit to our platform.
    </p>

    <h2>Be respectful</h2>
    <ul>
      <li>No harassment, hate speech, threats or discriminatory language.</li>
      <li>No personal attacks on customers, staff or other businesses.</li>
    </ul>

    <h2>Be honest</h2>
    <ul>
      <li>Only post reviews based on genuine experience.</li>
      <li>Do not post misleading health claims or unverified medical advice.</li>
      <li>Business listings must contain accurate, current information.</li>
    </ul>

    <h2>Keep it legal and safe</h2>
    <ul>
      <li>No spam, scams, or unauthorised advertising.</li>
      <li>No sharing of other people's personal information.</li>
      <li>No content that infringes copyright or trademarks.</li>
    </ul>

    <h2>Enforcement</h2>
    <p>
      We may edit or remove content and suspend accounts that breach these guidelines. Report concerns to
      admin@proagrisa.co.za.
    </p>
  </LegalPage>
);

export default CommunityGuidelines;
