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
      <strong>All sales are final. We do not offer refunds, returns or exchanges.</strong> Live
      cultures, perishable biological products and agricultural items cannot be resold once
      dispatched and are strictly non-refundable. If an item arrives damaged or incorrect, contact
      us within 24 hours of delivery with photographs; the remedy is limited to a replacement of
      the affected item where stock is available, at our sole discretion. There is no money-back
      guarantee of any kind.
    </p>

    <h2>Shipping charges</h2>
    <p>
      <strong>We never offer free shipping.</strong> Every order incurs a shipping charge
      calculated from the actual weight and dimensions of the parcel, displayed clearly at
      checkout before payment. Shipping fees are non-refundable once a parcel has been dispatched,
      including on uncollected or returned-to-sender parcels.
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
