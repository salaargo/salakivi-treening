"""Generate Salakivi Treening beginner PDF guide (Estonian)."""
from pathlib import Path

from fpdf import FPDF

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "Salakivi-Treening-Kasutusjuhend.pdf"
FONTS = Path(r"C:\Windows\Fonts")


class GuidePDF(FPDF):
    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_font("Body", "I", 9)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, "Salakivi Treening — kasutusjuhend", align="L")
        self.ln(12)

    def footer(self) -> None:
        self.set_y(-14)
        self.set_font("Body", "I", 9)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, str(self.page_no()), align="C")

    def h1(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Body", "B", 18)
        self.set_text_color(28, 28, 28)
        self.multi_cell(0, 9, text)
        self.set_x(self.l_margin)
        self.ln(2)

    def h2(self, text: str) -> None:
        self.ln(2)
        self.set_x(self.l_margin)
        self.set_font("Body", "B", 13)
        self.set_text_color(40, 95, 60)
        self.multi_cell(0, 7.5, text)
        self.set_x(self.l_margin)
        self.ln(1)

    def h3(self, text: str) -> None:
        self.ln(1.5)
        self.set_x(self.l_margin)
        self.set_font("Body", "B", 11)
        self.set_text_color(45, 45, 45)
        self.multi_cell(0, 6.5, text)
        self.set_x(self.l_margin)
        self.ln(0.5)

    def body(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Body", "", 11)
        self.set_text_color(35, 35, 35)
        self.multi_cell(0, 6.2, text)
        self.set_x(self.l_margin)
        self.ln(1.2)

    def bullet(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Body", "", 11)
        self.set_text_color(35, 35, 35)
        bullet_w = 6
        self.cell(bullet_w, 6.2, chr(8226))
        self.multi_cell(self.epw - bullet_w, 6.2, text)
        self.set_x(self.l_margin)
        self.ln(0.3)

    def tip(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_fill_color(232, 244, 235)
        self.set_font("Body", "I", 10)
        self.set_text_color(35, 70, 45)
        self.multi_cell(0, 5.8, "Vihje: " + text, fill=True)
        self.set_x(self.l_margin)
        self.ln(2)

    def centered(self, text: str, size: int = 11, style: str = "", color=(35, 35, 35)) -> None:
        self.set_x(self.l_margin)
        self.set_font("Body", style, size)
        self.set_text_color(*color)
        self.multi_cell(0, 7 if size >= 14 else 6.2, text, align="C")
        self.set_x(self.l_margin)


def build() -> Path:
    pdf = GuidePDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_font("Body", "", str(FONTS / "arial.ttf"))
    pdf.add_font("Body", "B", str(FONTS / "arialbd.ttf"))
    pdf.add_font("Body", "I", str(FONTS / "ariali.ttf"))
    pdf.add_page()

    # Cover
    pdf.ln(30)
    pdf.centered("Salakivi Treening", size=28, style="B", color=(28, 28, 28))
    pdf.ln(2)
    pdf.centered("Kasutusjuhend algajale", size=16, color=(55, 115, 70))
    pdf.ln(8)
    pdf.centered(
        "Lihtne juhend inimesele, kes avab äppi esimest korda.\n"
        "Samm-sammult: sisselogimine, seadistamine, treening ja STOPP.",
        size=11,
        color=(80, 80, 80),
    )
    pdf.ln(10)
    pdf.centered("Äppi aadress:", size=11, style="B", color=(35, 35, 35))
    pdf.centered(
        "https://salaargo.github.io/salakivi-treening/",
        size=11,
        color=(20, 90, 160),
    )
    pdf.ln(6)
    pdf.centered(
        "Sobib telefonile ja arvutile (veebibrauser).\n"
        "Soovitus: salvesta link telefoni avakuvale või brauseri lemmikutesse.",
        size=10,
        color=(100, 100, 100),
    )

    # 1
    pdf.add_page()
    pdf.h1("1. Mis see äpp on?")
    pdf.body("Salakivi Treening on treeningupäevik. Sellega saad:")
    pdf.bullet("näha oma treeningnädalat ja faasi (Start, Treening, Power, Taastus)")
    pdf.bullet("teha harjutusi seeriate kaupa (Start → Tehtud → paus)")
    pdf.bullet("salvestada pinke (masinaid) ja raskusi")
    pdf.bullet("näha treeningu statistikat (kogu aeg, harjutused, pausid)")
    pdf.bullet("hoida andmeid pilves — iga kasutaja näeb ainult oma logisid")
    pdf.tip("Äpp töötab brauseris. Eraldi App Store’i / Google Play installi pole vaja.")

    pdf.h1("2. Esimene kord — konto")
    pdf.h3("2.1 Ava link")
    pdf.body(
        "Ava telefonis või arvutis aadress:\n"
        "https://salaargo.github.io/salakivi-treening/"
    )
    pdf.h3("2.2 Loo konto")
    pdf.bullet('Vali vaheleht „Loo konto“.')
    pdf.bullet("Sisesta oma e-post.")
    pdf.bullet("Vali parool (vähemalt 6 tähemärki).")
    pdf.bullet('Vajuta „Registreeru“, seejärel logi sisse.')
    pdf.bullet(
        "Pärast esimest sisselogimist on sul kohe Argo valmis algmall "
        "(grupid, kavad, nädalad) — isiklik koopia, mida saad Seadetes muuta."
    )
    pdf.h3("2.3 Unustasid parooli?")
    pdf.bullet('Sisselogimise ekraanil vajuta „Unustasid parooli?“.')
    pdf.bullet("Sisesta e-post ja vajuta „Saada taastamislink“.")
    pdf.bullet("Ava meilis olev link ja määra uus parool.")
    pdf.tip("Kontrolli ka rämpsposti / Spam kausta. Taastamislink kehtib piiratud aja.")

    pdf.h1("3. Avaleht")
    pdf.body("Pärast sisselogimist näed pealehte:")
    pdf.bullet("ülal: Salakivi Treening + sinu e-post")
    pdf.bullet("praegune grupp ja faas (nt Treening, nädal 1/2)")
    pdf.bullet("nupp „Treenima“ — alusta treeningut")
    pdf.bullet("nupp „Seaded“ — muuda või loo oma gruppe, kavasid ja nädalaid")
    pdf.bullet("punane nupp „STOPP“ (all paremal) — lõpeta tänane treening enneaegu")

    # 4
    pdf.add_page()
    pdf.h1("4. Kuidas treenida (tavavoog)")
    pdf.h3("4.1 Treenima")
    pdf.bullet("Avalehel vajuta „Treenima“.")
    pdf.bullet("Vali „Jätkame treeningut“ (tavaliselt) või „Alustame uut faasi“.")
    pdf.bullet("Avaneb nädalavaade — vali tänane (või soovitud) treeningpäev.")

    pdf.h3("4.2 Vali harjutus")
    pdf.bullet("Näed nimekirja harjutustest.")
    pdf.bullet("Vajuta ühele harjutusele (või kahele, et teha segamini).")
    pdf.bullet("Vajuta nurgas „Start“.")

    pdf.h3("4.3 Üks seeria")
    pdf.bullet("Kontrolli pinki ja kg. Vajadusel muuda rippmenüüst.")
    pdf.bullet("Vajuta „Start“ — seeria algab.")
    pdf.bullet("Tee kordused.")
    pdf.bullet("Vajuta „Tehtud“.")
    pdf.bullet("Algab pausiaeg (timer). Võid oodata või vahele jätta.")
    pdf.bullet("Järgmine seeria / harjutus jätkub.")

    pdf.h3("4.4 Sauna!")
    pdf.body(
        "Kui kõik valitud harjutused on tehtud, avaneb „Sauna!“ ekraan.\n"
        "Seal näed:"
    )
    pdf.bullet("kogu treeningu aega")
    pdf.bullet("harjutuste aega (Start → Tehtud)")
    pdf.bullet("pauside aega")
    pdf.bullet("nupp „Valmis“ viib tagasi avalehele")
    pdf.tip(
        "Kui teed kahte harjutust segamini: äpp vahetab neid kordamööda "
        "(üks seeria ühest, siis teisest)."
    )

    pdf.h1("5. STOPP — treeningu enneaegne lõpetamine")
    pdf.body(
        "Igal lehel on punane nupp STOPP (all paremal).\n"
        "Kui pead treeningu pooleli jätma:"
    )
    pdf.bullet("Vajuta STOPP.")
    pdf.bullet(
        "Kuvatakse küsimus: „Oled kindel, et soovid tänast treeningut juba lõpetada?“"
    )
    pdf.bullet("Cancel — jätkad sealt, kus olid.")
    pdf.bullet(
        "OK — tänane treening lõpeb. Tegemata harjutused jäävad logisse punaseks."
    )
    pdf.tip('Nädalavaates näed osaliselt tehtud päeva juures sildi „Tegemata jäi“.')

    # 6
    pdf.add_page()
    pdf.h1("6. Seaded — mida seal teha?")
    pdf.body(
        "Iga kasutaja saab ise oma treeningkava muuta või juurde luua — "
        "adminit ega treenerit pole vaja.\n\n"
        "Esmakordsel sisselogimisel saad automaatselt Argo (Salakivi) valmis algmalli "
        "(grupid, kavad, nädalad, faasid). See on sinu isiklik koopia: muudatused "
        "salvestuvad ainult sinu kontole ja ei muuda teiste kasutajate kavasid."
    )
    pdf.h3("6.1 Treeninggrupid")
    pdf.bullet("Nt „Tõuke“, „Tõmme“, „Jalad + core“ (algmallis) või lisa oma.")
    pdf.bullet("Igal grupil on oma faasiring kalendri järgi.")

    pdf.h3("6.2 Treeningkavad")
    pdf.bullet("Kava kuulub gruppi.")
    pdf.bullet("Lisa või muuda harjutusi: nimi, seeriate arv (nt 4), paus sekundites.")
    pdf.bullet("Lisa pinke (masinaid) koos baasraskusega (kg).")

    pdf.h3("6.3 Nädalad")
    pdf.bullet("Koosta vähemalt 2 nädalamalli (või muuda algmalli).")
    pdf.bullet("Iga päeva jaoks vali grupp või puhkepäev.")
    pdf.bullet("Kalendris käivad nädalad kordamööda.")

    pdf.h3("6.4 Faasid")
    pdf.body(
        "Vaikimisi neli faasi: Start → Treening → Power → Taastus.\n"
        "Faasis saab muuta kestust (nädalad), korduste vahemikku ja raskuse kordajat."
    )

    pdf.h3("6.5 Väljalogimine")
    pdf.bullet("Seaded → „Logi välja“.")

    pdf.h1("7. Pink ja seeria treeningus")
    pdf.bullet("Iga seeria juures saad valida pinki (masinat).")
    pdf.bullet("Kg on vaikimisi soovitus faasi järgi; saad muuta.")
    pdf.bullet("Menüüst „+ Lisa pink…“ lisab uue pinki ka kavasse.")
    pdf.tip(
        "Hoia „Start“ nuppu peal (pikk vajutus), et avada kiirmenüü "
        "(nt märgi kõik seeriad tehtud)."
    )

    pdf.h1("8. Kiire kontrollnimekiri")
    pdf.bullet("1) Ava link brauseris")
    pdf.bullet("2) Loo konto / logi sisse (saad Argo algmalli)")
    pdf.bullet("3) Soovi korral Seaded: muuda gruppe / kavasid / nädalaid")
    pdf.bullet("4) Treenima → nädal → päev")
    pdf.bullet("5) Vali harjutus → Start → Tehtud → paus")
    pdf.bullet("6) Lõpus „Sauna!“ → Valmis")
    pdf.bullet("7) Kui pead katkestama: STOPP → OK")

    # 9
    pdf.add_page()
    pdf.h1("9. Probleemid / abi")
    pdf.h3("Ei saa sisse logida")
    pdf.bullet("Kontrolli e-posti ja parooli.")
    pdf.bullet("Proovi „Unustasid parooli?“.")
    pdf.bullet("Veendu, et kasutad õiget linki (ülal).")

    pdf.h3("Taastamislink ei tule")
    pdf.bullet("Oota paar minutit, kontrolli Spam kausta.")

    pdf.h3("Andmed ei salvestu")
    pdf.bullet("Vajad internetiühendust (pilvesünk).")
    pdf.bullet("Logi välja ja uuesti sisse.")

    pdf.h3("STOPP / Sauna ei vasta ootusele")
    pdf.bullet("STOPP lõpetab tänase päeva; tegemata jääb punaseks.")
    pdf.bullet("Täieliku treeningu lõpus tuleb Sauna! koos statistikaga.")

    pdf.ln(8)
    pdf.set_x(pdf.l_margin)
    pdf.set_draw_color(70, 130, 90)
    pdf.set_fill_color(245, 250, 246)
    pdf.set_font("Body", "B", 12)
    pdf.set_text_color(35, 35, 35)
    pdf.multi_cell(0, 8, "Kokkuvõte", fill=True)
    pdf.set_x(pdf.l_margin)
    pdf.ln(2)
    pdf.set_font("Body", "", 11)
    pdf.multi_cell(
        0,
        6.2,
        "1. Ava link → loo konto (saad Argo valmis algmalli).\n"
        "2. Vajuta Treenima → vali päev → harjutus.\n"
        "3. Start → Tehtud → paus → Sauna!\n"
        "4. Kui pead pooleli jätma: STOPP → OK.\n"
        "5. Seadetes saad oma kava ise muuta — adminit pole vaja.\n"
        "6. Andmed salvestuvad sinu konto alla pilves.",
    )
    pdf.set_x(pdf.l_margin)
    pdf.ln(6)
    pdf.set_font("Body", "I", 10)
    pdf.set_text_color(100, 100, 100)
    pdf.multi_cell(
        0,
        6,
        "Küsimuste korral kirjuta äpi adminile / Argole.\n"
        "Äpp: https://salaargo.github.io/salakivi-treening/",
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))
    return OUT


if __name__ == "__main__":
    path = build()
    print(path)
