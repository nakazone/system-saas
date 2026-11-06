#!/usr/bin/env python3
"""Fill ObraCrew / field ObraCam UI strings into dictionary.json (pt / en / es).

Reads i18n-crew-keys.txt (or rebuilds from i18n-missing.tsv), writes a TSV and merges.
Noise (CSS, class fragments) goes to ignore.json.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DICT = ROOT / "src/lib/i18n/dictionary.json"
IGNORE = ROOT / "src/lib/i18n/ignore.json"
KEYS = ROOT / "i18n-crew-keys.txt"
TSV = ROOT / "i18n-crew-fill.tsv"
MISSING = ROOT / "i18n-missing.tsv"

NOISE_KEY = re.compile(
    r"^(cubic-bezier|inset\(|translate3d|transform |scaleX|image/\*|© OpenStreetMap|"
    r"dy-toast|st-toast|builder_id=|customer_id=|-job-\{0\}|"
    r"cam-\{0\}|cam-up\{0\}|cm\{0\}Layer|om-shell-)",
    re.I,
)

BRANDS = {
    "ObraCrew",
    "ObraCam",
    "ObraMate",
    "ObraBuilder",
    "ObraChat",
    "ObraCalendar",
    "ObraQuote",
    "DuraSeal",
    "Hickory",
    "Maple",
    "Jacobean",
    "Ebony",
    "Natural",
    "Dark Walnut",
    "Early American",
    "Classic Gray",
    "Special Walnut",
    "Provincial",
    "Weathered Oak",
    "White Oak",
    "Red Oak",
    "Minwax",
    "Bona",
    "Maps",
}

# English source in code → (pt, es). en stays "=".
EN_SRC: dict[str, tuple[str, str]] = {
    "Installing": ("Instalando", "Instalando"),
    "Sanding": ("Lixando", "Lijando"),
    "Walk Through": ("Vistoria final", "Inspección final"),
    "Problem": ("Problema", "Problema"),
    "Choose your color": ("Escolha a sua cor", "Elige tu color"),
    "Choose your stain color": ("Escolha a cor do stain", "Elige el color del stain"),
    "HomeOwner": ("Cliente", "Propietario"),
    "no compressor": ("sem compressor", "sin compresor"),
    "Annot": ("Nota", "Nota"),
    "Delivery{0}": ("Entrega{0}", "Entrega{0}"),
    "We applied {0} stain sample{1} on your{2} floor. Please look at them, choose one and sign so we can finish your floors.": (
        "Aplicamos {0} amostra{1} de stain no seu piso{2}. Veja, escolha uma e assine para finalizarmos o piso.",
        "Aplicamos {0} muestra{1} de stain en tu piso{2}. Míralas, elige una y firma para terminar el piso.",
    ),
}

# Portuguese (or mixed) source → (en, es). pt stays "=".
PT_SRC: dict[str, tuple[str, str]] = {
    "· foto {0} de {1}": ("· photo {0} of {1}", "· foto {0} de {1}"),
    "{0} fotos do ObraCam": ("{0} ObraCam photos", "{0} fotos de ObraCam"),
    "{0} fotos prontas para compartilhar": ("{0} photos ready to share", "{0} fotos listas para compartir"),
    "{0}Apagar foto": ("{0}Delete photo", "{0}Borrar foto"),
    "{0}Compartilhar": ("{0}Share", "{0}Compartir"),
    "{0}Etiquetas": ("{0}Labels", "{0}Etiquetas"),
    "{0}Nota": ("{0}Note", "{0}Nota"),
    "Amarelo": ("Yellow", "Amarillo"),
    "Apagar foto": ("Delete photo", "Borrar foto"),
    "Aumentar zoom": ("Zoom in", "Acercar"),
    "Autor da foto atualizado": ("Photo author updated", "Autor de la foto actualizado"),
    "Azul": ("Blue", "Azul"),
    "Branco": ("White", "Blanco"),
    "Caneta": ("Pen", "Lápiz"),
    "Cinza": ("Gray", "Gris"),
    "Compartilhar foto": ("Share photo", "Compartir foto"),
    "Corrigida à mão ·": ("Corrected manually ·", "Corregida a mano ·"),
    "Dados da foto": ("Photo details", "Datos de la foto"),
    "data do arquivo": ("file date", "fecha del archivo"),
    "Diminuir zoom": ("Zoom out", "Alejar"),
    "Editar foto": ("Edit photo", "Editar foto"),
    "Editar marcações": ("Edit markup", "Editar marcas"),
    "Ela sai do job e do ObraCam.": ("It leaves the job and ObraCam.", "Sale del trabajo y de ObraCam."),
    "Entrega": ("Delivery", "Entrega"),
    "Escolher outra cor": ("Pick another color", "Elegir otro color"),
    "Esconder dados da foto": ("Hide photo details", "Ocultar datos de la foto"),
    "Esconder marcações": ("Hide markup", "Ocultar marcas"),
    "Escreva e aperte Enter": ("Type and press Enter", "Escribe y pulsa Intro"),
    "Espessura": ("Thickness", "Grosor"),
    "Espessura: {0}": ("Thickness: {0}", "Grosor: {0}"),
    "Etiquetas": ("Labels", "Etiquetas"),
    "Etiquetas{0}": ("Labels{0}", "Etiquetas{0}"),
    "Ex.: rodapé solto perto da porta da cozinha": (
        "E.g. loose baseboard near the kitchen door",
        "Ej.: rodapié suelto cerca de la puerta de la cocina",
    ),
    "Fase da foto": ("Photo phase", "Fase de la foto"),
    "Fase pela data da foto": ("Phase from photo date", "Fase por la fecha de la foto"),
    "Fase: {0}": ("Phase: {0}", "Fase: {0}"),
    "Foto do ObraCam": ("ObraCam photo", "Foto de ObraCam"),
    "Foto pronta para compartilhar": ("Photo ready to share", "Foto lista para compartir"),
    "Gerenciar": ("Manage", "Gestionar"),
    "GPS da foto": ("Photo GPS", "GPS de la foto"),
    "GPS do celular no envio": ("Phone GPS on upload", "GPS del móvil al enviar"),
    "hora do envio": ("upload time", "hora de envío"),
    "Laranja": ("Orange", "Naranja"),
    "Marcações removidas": ("Markup removed", "Marcas eliminadas"),
    "Marcações salvas": ("Markup saved", "Marcas guardadas"),
    "Marcar foto": ("Mark photo", "Marcar foto"),
    "Marcar{0}": ("Mark{0}", "Marcar{0}"),
    "Medição": ("Scan", "Medición"),
    "Mostrar marcações": ("Show markup", "Mostrar marcas"),
    "Não foi possível mudar": ("Couldn't change", "No se pudo cambiar"),
    "Não foi possível mudar a etapa": ("Couldn't change the stage", "No se pudo cambiar la etapa"),
    "Não foi possível mudar a fase": ("Couldn't change the phase", "No se pudo cambiar la fase"),
    "Não foi possível mudar as etiquetas": ("Couldn't change the labels", "No se pudieron cambiar las etiquetas"),
    "Não foi possível salvar a nota": ("Couldn't save the note", "No se pudo guardar la nota"),
    "Não foi possível salvar as marcações": ("Couldn't save the markup", "No se pudieron guardar las marcas"),
    "Nenhuma etiqueta criada.": ("No labels created.", "Ninguna etiqueta creada."),
    "Nota da foto": ("Photo note", "Nota de la foto"),
    "Nota{0}": ("Note{0}", "Nota{0}"),
    "Outra cor": ("Other color", "Otro color"),
    "pela câmera": ("from camera", "de la cámara"),
    "Pela data da foto e as datas do job": (
        "From the photo date and the job dates",
        "Por la fecha de la foto y las fechas del trabajo",
    ),
    "Preto": ("Black", "Negro"),
    "Quem tirou a foto": ("Who took the photo", "Quién hizo la foto"),
    "Recolher dados da foto": ("Collapse photo details", "Replegar datos de la foto"),
    "Refazer": ("Redo", "Rehacer"),
    "Retângulo": ("Rectangle", "Rectángulo"),
    "Rosa": ("Pink", "Rosa"),
    "Roxo": ("Purple", "Morado"),
    "Sem datas no job para definir a fase": ("No job dates to set the phase", "Sin fechas en el trabajo para definir la fase"),
    "Sem nota": ("No note", "Sin nota"),
    "Tirada por": ("Taken by", "Hecha por"),
    "usar a da data": ("use date-based", "usar la de la fecha"),
    "Ver dados da foto": ("View photo details", "Ver datos de la foto"),
    "Ver todos os dados da foto": ("View all photo details", "Ver todos los datos de la foto"),
    "Verde": ("Green", "Verde"),
    "Vermelho": ("Red", "Rojo"),
    "Voltar ao tamanho da tela": ("Fit to screen", "Ajustar a la pantalla"),
    "Campo · versão web (mesmas funções do celular)": (
        "Field · web version (same features as phone)",
        "Campo · versión web (mismas funciones que el móvil)",
    ),
    "Não deu para abrir a rota agora.": ("Couldn't open the route right now.", "No se pudo abrir la ruta ahora."),
    "Não foi possível carregar a agenda.": ("Couldn't load the schedule.", "No se pudo cargar la agenda."),
    "Sem conexão para abrir a rota agora.": (
        "No connection to open the route right now.",
        "Sin conexión para abrir la ruta ahora.",
    ),
    "Não deu para ler a foto. Tente de novo.": ("Couldn't read the photo. Try again.", "No se pudo leer la foto. Inténtalo de nuevo."),
    "Não deu para preparar a foto.": ("Couldn't prepare the photo.", "No se pudo preparar la foto."),
    "Nenhuma foto escolhida.": ("No photo selected.", "Ninguna foto elegida."),
    "Selecione uma imagem.": ("Select an image.", "Selecciona una imagen."),
    "{0} {1} subindo em segundo plano. Pode enviar o dia.": (
        "{0} {1} uploading in the background. You can submit the day.",
        "{0} {1} subiendo en segundo plano. Puedes enviar el día.",
    ),
    "{0} hoje · {1}": ("{0} today · {1}", "{0} hoy · {1}"),
    "{0} na agenda hoje": ("{0} on today's schedule", "{0} en la agenda de hoy"),
    "{0} obras hoje": ("{0} jobs today", "{0} obras hoy"),
    "+ Outra obra": ("+ Another job", "+ Otra obra"),
    "A foto de {0} ainda está subindo. O dia só pode ser enviado quando chegar pelo menos 1 foto de cada job.": (
        "The photo for {0} is still uploading. Submit the day only after at least 1 photo per job arrives.",
        "La foto de {0} aún se está subiendo. El día solo se puede enviar cuando llegue al menos 1 foto de cada trabajo.",
    ),
    "Abrir horas →": ("Open hours →", "Abrir horas →"),
    "Abrir ObraCam": ("Open ObraCam", "Abrir ObraCam"),
    "Abrir ObraCam →": ("Open ObraCam →", "Abrir ObraCam →"),
    "aguardando sinal": ("waiting for signal", "esperando señal"),
    "Ainda faltam {0} foto{1}. Tentamos de novo sozinhos quando o sinal melhorar.": (
        "{0} photo{1} still missing. We'll retry on our own when the signal improves.",
        "Aún faltan {0} foto{1}. Lo intentaremos solos cuando mejore la señal.",
    ),
    "Dia {0} voltou": ("Day {0} came back", "El día {0} volvió"),
    "Dia começou. Sem sinal: o horário fica salvo e é enviado quando a conexão voltar.": (
        "Day started. No signal: the time is saved and sent when connection returns.",
        "Día empezado. Sin señal: el horario se guarda y se envía cuando vuelva la conexión.",
    ),
    "Dia enviado. Bom descanso!": ("Day submitted. Rest well!", "Día enviado. ¡Buen descanso!"),
    "Falta foto · {0}": ("Photo missing · {0}", "Falta foto · {0}"),
    "Falta foto em {0}.": ("Photo missing on {0}.", "Falta foto en {0}."),
    "Fotos e obras ativas": ("Photos and active jobs", "Fotos y obras activas"),
    "Horário registrado. Quando terminar, finalize o dia.": (
        "Time logged. When you're done, finish the day.",
        "Horario registrado. Cuando termines, finaliza el día.",
    ),
    "Horas e pagamentos": ("Hours and pay", "Horas y pagos"),
    "início": ("start", "inicio"),
    "Minhas horas →": ("My hours →", "Mis horas →"),
    "Nada hoje": ("Nothing today", "Nada hoy"),
    "Não precisa escolher obra — só registrar o início.": (
        "No need to pick a job — just clock in.",
        "No hace falta elegir obra: solo registra el inicio.",
    ),
    "Nota do dia": ("Day note", "Nota del día"),
    "O início do dia ainda está esperando sinal. Finalize quando a conexão voltar.": (
        "Day start is still waiting for signal. Finish when connection returns.",
        "El inicio del día aún espera señal. Finaliza cuando vuelva la conexión.",
    ),
    "Obras do dia": ("Today's jobs", "Obras del día"),
    "Precisa de você": ("Needs you", "Necesita de ti"),
    "Pronto para o ponto": ("Ready to clock in", "Listo para fichar"),
    "Quando chegar, toque em Começar o dia.": (
        "When you arrive, tap Start the day.",
        "Cuando llegues, toca Empezar el día.",
    ),
    "Remover reembolso": ("Remove reimbursement", "Quitar reembolso"),
    "Sem sinal agora. As fotos sobem sozinhas quando a conexão voltar.": (
        "No signal now. Photos upload on their own when connection returns.",
        "Sin señal ahora. Las fotos suben solas cuando vuelva la conexión.",
    ),
    "Semana e pagamentos": ("Week and pay", "Semana y pagos"),
    "Tentar enviar fotos agora": ("Try uploading photos now", "Intentar enviar fotos ahora"),
    "Hoje | ObraCrew": ("Today | ObraCrew", "Hoy | ObraCrew"),
    "Lançar Diária": ("Log day", "Registrar jornada"),
    "{0} · em andamento": ("{0} · in progress", "{0} · en curso"),
    "Horas": ("Hours", "Horas"),
    "Idioma": ("Language", "Idioma"),
    "ObraCam": ("ObraCam", "ObraCam"),
    "Minha conta": ("My account", "Mi cuenta"),
    "Últimos trabalhos": ("Recent jobs", "Últimos trabajos"),
    "Scanner Recibo": ("Receipt scan", "Escanear recibo"),
    "Agendado · Lixa": ("Scheduled · Sanding", "Agendado · Lija"),
    "Ainda não concluído": ("Not completed yet", "Aún no concluido"),
    "Concluir a instalação? A lixa continua em aberto.": (
        "Complete installation? Sanding stays open.",
        "¿Concluir la instalación? La lija sigue abierta.",
    ),
    "Concluir a lixa e fechar o job?": (
        "Complete sanding and close the job?",
        "¿Concluir la lija y cerrar el trabajo?",
    ),
    "Instalação concluída. Falta a lixa.": (
        "Installation done. Sanding still open.",
        "Instalación concluida. Falta la lija.",
    ),
    "Lixa concluída.": ("Sanding completed.", "Lija concluida."),
    "Crie, renomeie e arquive as etiquetas das fotos": (
        "Create, rename and archive photo labels",
        "Crea, renombra y archiva las etiquetas de las fotos",
    ),
    "Jobs, orçamentos, faturas e o resto do sistema": (
        "Jobs, quotes, invoices and the rest of the system",
        "Trabajos, presupuestos, facturas y el resto del sistema",
    ),
    "O ObraCam é para administradores, gerentes e escritório": (
        "ObraCam is for admins, managers and office",
        "ObraCam es para administradores, gerentes y oficina",
    ),
    "Seu cargo continua vendo as fotos no ObraMate. Se precisar deste app, fale com o administrador da sua empresa.": (
        "Your role still sees photos in ObraMate. If you need this app, talk to your company admin.",
        "Tu cargo sigue viendo las fotos en ObraMate. Si necesitas esta app, habla con el administrador de tu empresa.",
    ),
    "{0} — início": ("{0} — home", "{0} — inicio"),
    "Agrupar": ("Group", "Agrupar"),
    "Buscar obra ou endereço": ("Search job or address", "Buscar obra o dirección"),
    "Carregando jobs": ("Loading jobs", "Cargando trabajos"),
    "Por cliente": ("By client", "Por cliente"),
    "Esta semana": ("This week", "Esta semana"),
    "Em produção ou últimos trabalhos": ("In production or recent jobs", "En producción o trabajos recientes"),
    "Nenhuma obra neste dia.": ("No jobs on this day.", "Ninguna obra en este día."),
    "Nenhum trabalho em produção.": ("No jobs in production.", "Ningún trabajo en producción."),
    "Nenhum trabalho recente.": ("No recent jobs.", "Ningún trabajo reciente."),
    "Sem conexão": ("No connection", "Sin conexión"),
    "Não deu para carregar o ObraCam": ("Couldn't load ObraCam", "No se pudo cargar ObraCam"),
    "Confira a internet do aparelho e tente de novo.": (
        "Check the device internet and try again.",
        "Comprueba la conexión del aparato e inténtalo de nuevo.",
    ),
    "O servidor não respondeu agora. Tente de novo em instantes.": (
        "The server didn't respond. Try again in a moment.",
        "El servidor no respondió. Inténtalo de nuevo en un momento.",
    ),
    "Comece o dia em Hoje para lançar o recibo.": (
        "Start the day in Today to submit a receipt.",
        "Empieza el día en Hoy para registrar el recibo.",
    ),
    "Gasolina, material ou ferramenta — a foto vai para o reembolso do seu dia.": (
        "Gas, material or tool — the photo goes to your day reimbursement.",
        "Gasolina, material o herramienta: la foto va al reembolso del día.",
    ),
    "Confira o valor e envie.": ("Check the amount and send.", "Comprueba el importe y envía."),
    "Informe o valor do recibo.": ("Enter the receipt amount.", "Indica el importe del recibo."),
    "Enviar recibo": ("Send receipt", "Enviar recibo"),
    "Outra foto": ("Another photo", "Otra foto"),
    "Ex.: gasolina, material": ("E.g. gas, material", "Ej.: gasolina, material"),
    "Seu usuário ainda não está ligado à folha.": (
        "Your user isn't linked to payroll yet.",
        "Tu usuario aún no está vinculado a la nómina.",
    ),
    "Fotos recentes": ("Recent photos", "Fotos recientes"),
    "Sem fase": ("No phase", "Sin fase"),
    "Enviar fotos": ("Upload photos", "Enviar fotos"),
    "Baixar": ("Download", "Descargar"),
    "Arquivar": ("Archive", "Archivar"),
    "Restaurar": ("Restore", "Restaurar"),
    "Sair da seleção": ("Exit selection", "Salir de la selección"),
    "Selecionar dia": ("Select day", "Seleccionar día"),
    "Desmarcar dia": ("Clear day", "Quitar día"),
    "Desmarcar todas": ("Clear all", "Quitar todas"),
    "Fotos selecionadas": ("Selected photos", "Fotos seleccionadas"),
    "Apagar fotos": ("Delete photos", "Borrar fotos"),
    "Esconder": ("Hide", "Ocultar"),
    "Carregando fotos": ("Loading photos", "Cargando fotos"),
    "Carregando o mapa…": ("Loading the map…", "Cargando el mapa…"),
    "Sem conexão com a internet. Confira o sinal e tente de novo.": (
        "No internet connection. Check the signal and try again.",
        "Sin conexión a internet. Comprueba la señal e inténtalo de nuevo.",
    ),
    "ObraCam app": ("ObraCam app", "App ObraCam"),
}


def load_keys() -> list[str]:
    if KEYS.exists():
        return [ln for ln in KEYS.read_text().splitlines() if ln.strip()]
    return []


def is_noise(k: str) -> bool:
    if NOISE_KEY.search(k):
        return True
    if re.search(r"px.*round|scale\(|translate3d", k):
        return True
    return False


def main() -> None:
    keys = [k for k in load_keys() if not is_noise(k)]
    ignore = set(json.loads(IGNORE.read_text()))
    noise_added = []
    for k in load_keys():
        if is_noise(k) and k not in ignore:
            ignore.add(k)
            noise_added.append(k)
    if noise_added:
        IGNORE.write_text(json.dumps(sorted(ignore), ensure_ascii=False, indent=2) + "\n")
        print(f"ignored {len(noise_added)} noise keys")

    lines = ["# source\tpt\ten\tes\t(file)"]
    missing: list[str] = []
    for k in keys:
        if k in BRANDS:
            lines.append(f"{k}\t=\t=\t=\tcrew")
            continue
        if k in EN_SRC:
            pt, es = EN_SRC[k]
            lines.append(f"{k}\t{pt}\t=\t{es}\tcrew")
            continue
        if k in PT_SRC:
            en, es = PT_SRC[k]
            lines.append(f"{k}\t=\t{en}\t{es}\tcrew")
            continue
        missing.append(k)

    # Second pass: load remaining from external pack if present
    pack = ROOT / "scripts/i18n-obracrew-pack.json"
    if pack.exists():
        extra = json.loads(pack.read_text())
        still = []
        for k in missing:
            row = extra.get(k)
            if not row:
                still.append(k)
                continue
            pt, en, es = row.get("pt", "="), row.get("en"), row.get("es")
            if not en or not es:
                still.append(k)
                continue
            lines.append(f"{k}\t{pt}\t{en}\t{es}\tcrew")
        missing = still

    TSV.write_text("\n".join(lines) + "\n")
    print(f"wrote {len(lines)-1} rows → {TSV.relative_to(ROOT)}")
    if missing:
        Path("/tmp/crew-untranslated.txt").write_text("\n".join(missing) + "\n")
        print(f"still untranslated: {len(missing)} → /tmp/crew-untranslated.txt")
        for k in missing[:40]:
            print(" ", k)
    else:
        print("all keys covered")


if __name__ == "__main__":
    main()
