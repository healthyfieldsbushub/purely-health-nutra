import { LegalPage } from "@/components/legal/LegalPage";

const CopyrightPolicy = () => (
  <LegalPage
    title="Copyright Policy"
    slug="copyright-policy"
    description="How to report copyright infringement and how Purely Health Nutra handles takedown notices."
  >
    <p>
      We respect intellectual property rights and expect our users to do the same. All site content,
      images and product text are owned by Purely Health Nutra or its licensors unless stated otherwise.
    </p>

    <h2>Reporting infringement</h2>
    <p>Send a notice to admin@proagrisa.co.za including:</p>
    <ul>
      <li>Your name, address and contact details.</li>
      <li>A description of the copyrighted work you claim has been infringed.</li>
      <li>The URL of the allegedly infringing content.</li>
      <li>A statement that you believe in good faith the use is unauthorised.</li>
      <li>A statement that the information is accurate, and your signature.</li>
    </ul>

    <h2>Our process</h2>
    <p>
      We review valid notices promptly and may remove or disable access to the content. We will notify the
      person who posted it, who may submit a counter-notice.
    </p>

    <h2>Repeat infringers</h2>
    <p>Accounts that repeatedly infringe copyright may be suspended or terminated.</p>
  </LegalPage>
);

export default CopyrightPolicy;
