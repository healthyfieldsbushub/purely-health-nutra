import { LegalPage } from "@/components/legal/LegalPage";

const PrivacyPolicy = () => (
  <LegalPage
    title="Privacy Policy"
    slug="privacy-policy"
    description="How Purely Health Nutra collects, uses, stores and protects your personal information."
  >
    <p>
      This Privacy Policy explains how Purely Health Nutra ("we", "us") collects, uses and protects
      personal information when you visit our website, place an order or contact us.
    </p>

    <h2>Information we collect</h2>
    <ul>
      <li>Contact details you provide: name, email address, phone number and delivery address.</li>
      <li>Order and payment information processed by our payment providers.</li>
      <li>Technical data such as IP address, browser type and pages visited.</li>
    </ul>

    <h2>How we use your information</h2>
    <ul>
      <li>To process, ship and support your orders.</li>
      <li>To respond to enquiries and provide customer service.</li>
      <li>To improve our products, website and marketing (where you have consented).</li>
    </ul>

    <h2>Sharing your information</h2>
    <p>
      We share information only with service providers who help us operate the store, such as payment
      gateways, couriers, email and analytics providers. We do not sell your personal information.
    </p>

    <h2>Data retention</h2>
    <p>We keep personal information only as long as needed for the purposes above or as required by law.</p>

    <h2>Your rights</h2>
    <p>
      You may request access to, correction of, or deletion of your personal information by contacting us
      at admin@proagrisa.co.za.
    </p>

    <h2>Contact</h2>
    <p>Purely Health Nutra, Gauteng, South Africa — admin@proagrisa.co.za</p>
  </LegalPage>
);

export default PrivacyPolicy;
