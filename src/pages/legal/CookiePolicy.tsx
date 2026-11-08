import { LegalPage } from "@/components/legal/LegalPage";

const CookiePolicy = () => (
  <LegalPage
    title="Cookie Policy"
    slug="cookie-policy"
    description="What cookies Purely Health Nutra uses, why we use them and how you can control them."
  >
    <p>
      Cookies are small text files stored on your device. This policy explains which cookies we use and
      how you can manage them.
    </p>

    <h2>Types of cookies we use</h2>
    <ul>
      <li><strong>Essential</strong> — required for the cart, checkout and secure sign-in.</li>
      <li><strong>Preference</strong> — remember settings such as currency and consent choice.</li>
      <li><strong>Analytics</strong> — help us understand how visitors use the site.</li>
      <li><strong>Marketing</strong> — used to measure campaigns where enabled.</li>
    </ul>

    <h2>Managing cookies</h2>
    <p>
      You can accept or decline non-essential cookies using the banner shown on your first visit. You can
      also block or delete cookies in your browser settings, though some features may stop working.
    </p>

    <h2>Third-party cookies</h2>
    <p>
      Analytics and advertising partners may set their own cookies. Their use of data is governed by their
      own privacy policies.
    </p>

    <h2>Contact</h2>
    <p>Questions about cookies? Email admin@proagrisa.co.za.</p>
  </LegalPage>
);

export default CookiePolicy;
