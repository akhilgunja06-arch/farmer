import { useTranslation } from 'react-i18next';
import { Notice } from '@/components/ui/Card';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/**
 * Terms of service and privacy policy.
 *
 * These are deliberately written as a plain-language description of what the
 * application actually does with data, because that is what the code can
 * honestly support. They are not a substitute for legal review, and the notice
 * at the top says so rather than implying otherwise.
 */
export default function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const { t } = useTranslation();
  useDocumentTitle(kind === 'privacy' ? t('footer.privacy') : t('footer.terms'));

  return (
    <div className="container-page py-10">
      <article className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold text-soil-900 sm:text-4xl">
          {kind === 'privacy' ? t('footer.privacy') : t('footer.terms')}
        </h1>
        <p className="mt-2 text-sm text-soil-500">
          Last updated {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </p>

        <Notice tone="warning" className="mt-6" title="Not yet legally reviewed">
          This text describes how the application actually handles data and orders, written in plain
          language. It has not been reviewed by a lawyer and is not legal advice. Have it reviewed
          against the laws that apply to you — including India&rsquo;s Digital Personal Data
          Protection Act — before you operate this service publicly.
        </Notice>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-soil-700">
          {kind === 'privacy' ? <PrivacyBody /> : <TermsBody />}
        </div>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-bold text-soil-900">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function PrivacyBody() {
  return (
    <>
      <Section title="What we collect">
        <p>
          <strong>Account details:</strong> your name, email address, phone number, and the state,
          district and village you give us. Farmers also provide farm details and which crops they
          grow.
        </p>
        <p>
          <strong>Marketplace activity:</strong> the crops you list or order, your cart, your orders
          and their status, and any messages you send through the platform.
        </p>
        <p>
          <strong>Reviews:</strong> the ratings and comments you leave, and any photo you attach.
        </p>
        <p>
          <strong>Technical records:</strong> security-relevant events such as sign-in attempts, and
          an audit log of administrative actions.
        </p>
      </Section>

      <Section title="What we do not collect">
        <p>
          We do not store card numbers, CVV codes, UPI PINs, or bank credentials. Where an online
          payment gateway is configured, payment details go directly to that provider and we receive
          only a reference and a status.
        </p>
        <p>
          We do not collect your live location. A farmer may choose to publish an approximate map
          location for their farm; if they do not, no coordinates are recorded publicly.
        </p>
      </Section>

      <Section title="Who can see what">
        <p>
          <strong>Public:</strong> a farmer&rsquo;s name, farm name, village, district, state,
          verification status, rating, and their active crop listings. If a farmer publishes a map
          location, that too.
        </p>
        <p>
          <strong>Between trading partners:</strong> a farmer sees the orders placed with them and
          the customer&rsquo;s delivery details for those orders. A customer sees the farmer&rsquo;s
          public profile.
        </p>
        <p>
          <strong>Private:</strong> your email address, phone number, saved addresses, and messages
          are visible only to you, the person you are messaging, and administrators handling a
          report. Your phone number is never shared automatically — you choose to share it.
        </p>
        <p>
          These limits are enforced by row level security inside the database, not only by the
          interface.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You can change your preferred language, edit your profile, and manage your saved addresses
          from your account settings. You can ask us to delete your account by writing to the
          support address in the footer.
        </p>
        <p>
          A farmer can mark a listing out of stock or deactivate it at any time, and can choose
          whether to offer delivery, pickup, and whether to publish a map location.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          Account and order records are kept while your account exists, and for as long as needed to
          resolve disputes and meet accounting obligations. Administrative audit records are retained
          to keep the platform accountable.
        </p>
      </Section>
    </>
  );
}

function TermsBody() {
  return (
    <>
      <Section title="What RythuDirect is">
        <p>
          RythuDirect is a marketplace that lets farmers list agricultural produce and lets
          customers buy it directly. We provide the platform. The sale itself is between the farmer
          and the customer.
        </p>
      </Section>

      <Section title="Farmers agree to">
        <p>
          List produce you actually have, describe it honestly, and set a price you intend to honour.
          Fulfil or decline orders promptly.
        </p>
        <p>
          Do not claim your produce is laboratory tested, certified organic, or officially inspected
          unless you hold a genuine report you can attach. Claims of that kind are only displayed
          after our team reviews the document.
        </p>
      </Section>

      <Section title="Customers agree to">
        <p>
          Provide an accurate delivery address and contact number, pay the agreed amount, and report
          problems honestly.
        </p>
      </Section>

      <Section title="Prices and orders">
        <p>
          The farmer sets the price. RythuDirect does not set, recommend, or automatically adjust it.
          Market price information, where shown, is for comparison only.
        </p>
        <p>
          The total you pay — unit price, quantity, delivery charge and any service fee — is shown in
          full on the cart and again at checkout before you confirm. An order is not binding on the
          farmer until they accept it.
        </p>
      </Section>

      <Section title="Quality and inspection">
        <p>
          A quality grade is the farmer&rsquo;s own description. It is not a laboratory result.
          Image analysis, where offered, is a preliminary visual assessment and does not establish
          chemical residue levels, pesticide safety, microbial contamination, nutritional
          composition, laboratory grade, or food safety certification.
        </p>
      </Section>

      <Section title="Reviews and conduct">
        <p>
          Only a customer who bought and received a product may review it, and only once per order.
          We may hide a review that is abusive, false, or unrelated to the transaction, and we may
          suspend an account that repeatedly breaks these terms.
        </p>
      </Section>

      <Section title="Limits of our responsibility">
        <p>
          We are not a party to the sale and cannot guarantee the quality, quantity, or timely
          delivery of any produce. Where a dispute arises, we will help both sides reach a
          resolution, and we may suspend accounts that misuse the platform.
        </p>
      </Section>
    </>
  );
}
