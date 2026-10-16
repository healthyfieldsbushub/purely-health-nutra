import { LegalPage } from "@/components/legal/LegalPage";

const TermsOfService = () => (
  <LegalPage
    title="Terms of Service"
    slug="terms-of-service"
    description="The terms and conditions that apply when you use the Purely Health Nutra website and place orders."
  >
    <p>
      By using this website or placing an order you agree to these Terms of Service. Please read them
      carefully.
    </p>

    <h2>Orders and pricing</h2>
    <ul>
      <li>All prices are shown in South African Rand (ZAR) unless stated otherwise.</li>
      <li>An order is only confirmed once payment has been successfully received.</li>
      <li>We may cancel an order if a product is unavailable or a pricing error occurs.</li>
    </ul>

    <h2>Shipping and delivery</h2>
    <p>
      Delivery timelines are estimates. Risk in the goods passes to you on delivery. Export orders may be
      subject to local import requirements.
    </p>

    <h2>Returns and refunds</h2>
    <p>
      Live cultures and perishable products may be exempt from returns. Contact us within 7 days of
      delivery if an item arrives damaged or incorrect.
    </p>

    <h2>Health disclaimer</h2>
    <p>
      Our products are not intended to diagnose, treat, cure or prevent any disease. Consult a qualified
      healthcare practitioner before changing your diet or supplement routine.
    </p>

    <h2>Limitation of liability</h2>
    <p>
      To the maximum extent permitted by law, our liability is limited to the value of the products
      purchased.
    </p>

    <h2>Governing law</h2>
    <p>These terms are governed by the laws of the Republic of South Africa.</p>
  </LegalPage>
);

export default TermsOfService;
