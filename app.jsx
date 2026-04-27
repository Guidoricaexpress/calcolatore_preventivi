const { useState, useEffect, useMemo } = React;

function App() {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);
  const [fields, setFields] = useState(null);
  const [listini, setListini] = useState(null);
  
  const [cliente, setCliente] = useState("");
  const [listino, setListino] = useState(""); 
  const [rows, setRows] = useState([]);
  const [accessories, setAccessories] = useState({});

  useEffect(() => {
    Promise.all([
      fetch('config.json').then(res => res.json()),
      fetch('fields.json').then(res => res.json()),
      fetch('listini.json').then(res => res.json())
    ]).then(([conf, flds, listData]) => {
       setConfig(conf);
       setFields(flds);
       setListini(listData);
       setListino(conf.defaultListino);
       
       let initialAccessories = {};
       conf.condizioniAccessorie.forEach(acc => {
          initialAccessories[acc.id] = { active: false, perc: acc.perc, isCompound: acc.isCompound, label: acc.label };
       });
       setAccessories(initialAccessories);
       
       setRows([{ id: Date.now(), provincia: conf.defaultProvincia, numPallet: 1, lunghezza: 0, larghezza: 0, altezza: 0, peso: 0, formato: "", tipo: "Non trovato", error: false }]);
       setLoading(false);
    }).catch(err => {
       console.error("Errore AJAX:", err);
       alert("Errore nel caricamento dei file JSON di configurazione.\nAvvia il programma tramite 'Avvia_Calcolatore.bat' per abilitare la lettura locale.");
    });
  }, []);

  const listiniDisponibili = useMemo(() => listini ? Object.keys(listini.rates).sort() : [], [listini]);
  
  const clientiDisponibili = useMemo(() => listini && listini.clienti ? Object.keys(listini.clienti).sort() : [], [listini]);
  
  const provinceDisponibili = useMemo(() => {
    if (!listini || !listini.rates[listino]) return [];
    return Object.keys(listini.rates[listino]).sort();
  }, [listini, listino]);

  const formatListinoName = (code) => {
    if (!config || !config.listiniMapping) return code;
    return config.listiniMapping[code] || code;
  };

  const getFormato = (lun, lar) => {
    if (!lun || !lar) return "Inserire Misure";
    const minD = Math.min(lun, lar);
    const maxD = Math.max(lun, lar);
    if (minD <= config.regoleFormato.standard_min_dim_limit && maxD <= config.regoleFormato.standard_max_dim_limit) return "Standard";
    return "Fuori formato";
  };

  const getTipo = (Alt, Pso) => {
    if (!Alt || !Pso) return "Non trovato";
    const h = parseFloat(Alt);
    const p = parseFloat(Pso);
    const found = listini.formato.find(f => p >= f.peso_da && p <= f.peso_a && h >= f.alt_da && h <= f.alt_a);
    return found ? found.categoria : "Non trovato";
  };

  const handleRowChange = (index, field, value) => {
    const newRows = [...rows];
    let val = parseFloat(value);
    // eccezione per provincia che è stringa
    if (field === 'provincia') {
       newRows[index][field] = value;
    } else {
       if (isNaN(val)) val = 0;
       newRows[index][field] = value === '' ? '' : val;
    }

    const r = newRows[index];
    r.formato = getFormato(r.lunghezza, r.larghezza);
    r.tipo = getTipo(r.altezza, r.peso);
    
    setRows(newRows);
  };

  const handleAccessoryChange = (id, field, value) => {
    setAccessories(prev => ({
       ...prev,
       [id]: { ...prev[id], [field]: value }
    }));
  };

  const addRow = () => {
    setRows([...rows, { id: Date.now(), provincia: config.defaultProvincia, numPallet: 1, lunghezza: 0, larghezza: 0, altezza: 0, peso: 0, formato: "", tipo: "Non trovato", error: false }]);
  };

  const removeRow = (index) => {
    if (rows.length > 1) {
      setRows(rows.filter((_, i) => i !== index));
    }
  };

  const { isGlobalError, totaleNoloRicalcolato, mList, totaleFinale, processedRows } = useMemo(() => {
    if (!listini || !config || rows.length === 0) return { isGlobalError: false, totaleNoloRicalcolato: 0, mList: {}, totaleFinale: 0, processedRows: rows };

    let calcTotaleNoloRicalcolato = 0;
    let calcMList = {};
    Object.keys(accessories).forEach(k => calcMList[k] = 0);
    let errGlobal = false;

    const isNoStop = listino.toUpperCase().includes("NS") || listino.toUpperCase().includes("STOP");

    const pRows = rows.map(r => {
      const proc = { ...r, errorText: "" };
      let noloSingolo = 0;

      if (proc.tipo !== "Non trovato") {
        const rateTable = listini.rates[listino];
        if (rateTable && rateTable[proc.provincia]) {
            let p = rateTable[proc.provincia][proc.tipo];
            if (p) {
               noloSingolo = p;
            } else { proc.errorText = "Tariffa non trovata"; }
        } else { proc.errorText = "Provincia o Listino errato"; } 
      } else {
         if(proc.peso > 0) proc.errorText = "Nessun Tipo compatibile"; 
      }
      
      const noloXBancali = noloSingolo * (proc.numPallet || 1);
      
      // Riprezzamento Excel: =CERCA.X(ARROTONDA((L*W)/10000;3)...)
      let riprezzamento_perc = 0;
      if (proc.formato === "Fuori formato") {
         const areaRounded = Math.round(((proc.lunghezza * proc.larghezza) / 10000) * 1000) / 1000;
         const areaStr = areaRounded.toString();
         if (listini.riprezzamenti && listini.riprezzamenti[areaStr] !== undefined) {
             riprezzamento_perc = listini.riprezzamenti[areaStr] / 100;
         } else {
             proc.errorText = "Da valutare (Area non in tabella)";
         }
      }
      
      if (proc.errorText) errGlobal = true;
      proc.error = !!proc.errorText;

      const totConRiprezzo = noloXBancali * (1 + riprezzamento_perc);
      calcTotaleNoloRicalcolato += totConRiprezzo;

      // Zona Disagiata a livello di riga
      const accZona = accessories['zona'];
      let rowZonaAddition = 0;
      if (accZona && accZona.active) {
         rowZonaAddition = totConRiprezzo * (accZona.perc / 100);
         calcMList['zona'] += rowZonaAddition;
      }
      
      const o3_totale_riga = totConRiprezzo + rowZonaAddition;

      // Ritiri con limiti
      const accRitiri = accessories['ritiri'];
      if (accRitiri && accRitiri.active) {
         if (isNoStop) {
            if (proc.numPallet > 6) { proc.errorText = "Cambiare servizio in Standard"; errGlobal = true; proc.error = true; }
            else { calcMList['ritiri'] += o3_totale_riga * 0.15; } 
         } else {
            if (proc.numPallet > 10) { proc.errorText = "Errore: Bancali > 10"; errGlobal = true; proc.error = true; }
            else { calcMList['ritiri'] += o3_totale_riga * 0.10; } 
         }
      }

      // ETS & ADR 
      const accEts = accessories['ets'];
      if (accEts && accEts.active) {
         calcMList['ets'] += o3_totale_riga * (accEts.perc / 100);
      }
      const accAdr = accessories['adr'];
      if (accAdr && accAdr.active) {
         calcMList['adr'] += o3_totale_riga * (accAdr.perc / 100);
      }

      return proc;
    });

    let finalSum = calcTotaleNoloRicalcolato;
    Object.values(calcMList).forEach(val => finalSum += val);

    return { 
       isGlobalError: errGlobal, 
       totaleNoloRicalcolato: calcTotaleNoloRicalcolato, 
       mList: calcMList, 
       totaleFinale: finalSum, 
       processedRows: pRows 
    };
  }, [rows, listino, accessories, listini, config]);

  if (loading) return <div style={{padding: '2rem'}}>Caricamento Motore Applicativo in corso... L'app necessita dell'avvio tramite server locale (.bat).</div>;

  // Render dinamico delle colonne
  const renderCell = (row, index, col) => {
    if (col.type === 'select' && col.id === 'provincia') {
       return (
         <select value={row[col.id]} onChange={e => handleRowChange(index, col.id, e.target.value)} style={{width: col.width, padding: '0.4rem', borderRadius: '4px'}}>
            {provinceDisponibili.map(p => <option key={p} value={p}>{p}</option>)}
         </select>
       );
    }
    if (col.type === 'number') {
       return <input type="number" min={col.id==='numPallet'?1:0} placeholder={col.placeholder||''} value={row[col.id] || ''} onChange={e => handleRowChange(index, col.id, e.target.value)} style={{width: col.width}}/>;
    }
    if (col.type === 'readonly_tag') {
       const isError = col.id === 'formato' && row[col.id] === 'Fuori formato' || col.id === 'tipo' && row.error;
       return (
          <div style={{display: 'flex', flexDirection: 'column', gap: '0.2rem'}}>
             <span className={`tag ${isError ? 'error' : ''}`}>{row[col.id] || '-'}</span>
             {row.error && <span style={{fontSize: '0.7rem', color: 'red', fontWeight: 'bold'}}>{row.errorText}</span>}
          </div>
       );
    }
    return <span>{row[col.id]}</span>;
  };

  const handleSaveText = () => {
    let txt = `${config.stampa.titolo.toUpperCase()}\n`;
    txt += `--------------------------------------------------\n`;
    txt += `Data: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n`;
    txt += `Cliente: ${cliente || 'Nessuno'}\n`;
    txt += `Listino Base: ${formatListinoName(listino)}\n`;
    txt += `\n--- DETTAGLIO SPEDIZIONI ---\n`;
    
    processedRows.forEach((r, i) => {
       txt += `[Riga ${i+1}] Provincia: ${r.provincia} | Pallet: ${r.numPallet} | Misure: ${r.lunghezza}x${r.larghezza}x${r.altezza} cm - ${r.peso} kg | For: ${r.formato} | Tip: ${r.tipo}`;
       if (r.errorText) txt += `\n         -> ATTENZIONE: ${r.errorText}`;
       txt += `\n`;
    });

    txt += `\n--- RIEPILOGO COSTI ---\n`;
    txt += `Subtotale Nolo (incluso eventuali riprezzamenti Fuori Formato): € ${totaleNoloRicalcolato.toFixed(2)}\n`;
    
    Object.keys(accessories).forEach(key => {
       if (accessories[key].active) {
          const acc = accessories[key];
          txt += `${acc.label} ${key === 'ritiri' ? '(Dinamica)' : '(' + acc.perc + '%)'}: + € ${mList[key].toFixed(2)}\n`;
       }
    });

    txt += `--------------------------------------------------\n`;
    txt += `TOTALE FINALE: ${isGlobalError ? 'NON VALIDO (Risolvere errori riga)' : '€ ' + totaleFinale.toFixed(2)}\n`;
    txt += `--------------------------------------------------\n`;
    
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Preventivo_${cliente ? cliente.replace(/\\s+/g, '_') : 'Generico'}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container">
      <div className="header no-print">
        <div>
          <h1>{config.stampa.titolo}</h1>
          <div className="header-accent"></div>
        </div>
        <div style={{display: 'flex', gap: '1rem'}}>
          <button className="btn btn-primary" onClick={handleSaveText} title="Scarica un file di testo riassuntivo">
             💾 Salva Preventivo
          </button>
          <button className="btn btn-secondary" onClick={() => window.print()} title="Stampa o salva in PDF usando il prompt di sistema">
             🖨️ Stampa PDF
          </button>
        </div>
      </div>

      {/* Intestazione Mostrata solo in Stampa */}
      <div className="print-only" style={{ marginBottom: '20px', fontSize: '1.2rem', fontWeight: 'bold' }}>
        {cliente && <div>Cliente: {cliente}</div>}
        <div>{config.stampa.prefix_tratta} {rows.length > 0 ? (rows.every(r => r.provincia === rows[0].provincia) ? rows[0].provincia : 'Destinazioni Multiple') : ''}</div>
      </div>

      <div className="app-layout">
        <div className="main-content">
          <div className="card">
            <h2 className="card-title">📦 Dati Spedizione</h2>
            
            <div className="form-grid" style={{ marginBottom: '2rem', borderBottom: '1px solid #eee', paddingBottom: '1rem'}}>
              <div className="form-group no-print">
                <label>Cliente (Seleziona per caricare listino)</label>
                <select value={cliente} onChange={e => {
                   const val = e.target.value;
                   setCliente(val);
                   if (val && listini && listini.clienti && listini.clienti[val]) {
                      const code = listini.clienti[val];
                      if (listini.rates[code]) setListino(code);
                   }
                }} style={{maxWidth: '300px'}}>
                  <option value="">-- Manuale (o Nessuno) --</option>
                  {clientiDisponibili.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group no-print">
                <label>Listino Base</label>
                <select value={listino} onChange={e => {
                   setListino(e.target.value);
                   setCliente(""); // Resetta il cliente per mostrare la selezione manuale
                }} style={{maxWidth: '300px'}}>
                  {listiniDisponibili.map(l => <option key={l} value={l}>{formatListinoName(l)}</option>)}
                </select>
              </div>
            </div>

            <div style={{overflowX: 'auto'}}>
            <table className="data-table">
              <thead>
                <tr>
                  {fields.table_columns.map(col => <th key={col.id}>{col.label}</th>)}
                  <th className="no-print">Azione</th>
                </tr>
              </thead>
              <tbody>
                {processedRows.map((row, index) => (
                  <tr key={row.id} style={row.error ? {backgroundColor: '#FEF2F2'} : {}}>
                    {fields.table_columns.map(col => (
                       <td key={col.id}>{renderCell(row, index, col)}</td>
                    ))}
                    <td className="no-print">
                      <button className="btn btn-danger" style={{padding: '0.4rem', minWidth: '40px'}} title="Elimina riga" onClick={() => removeRow(index)}>🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            <div className="no-print" style={{ marginTop: '1rem' }}>
              <button className="btn btn-secondary" onClick={addRow}>+ Aggiungi Riga Pallet</button>
            </div>
          </div>
          
          <div className="card no-print" style={{marginTop: '2rem'}}>
             <h2 className="card-title">⚙️ Condizioni Accessorie (JSON Backend)</h2>
             <p style={{marginBottom: '1rem', fontSize: '0.85rem', color: '#666'}}>Queste etichette e logiche sono configurate in <code>config.json</code>.</p>
             <div className="form-grid">
                 {Object.keys(accessories).map(key => {
                    const acc = accessories[key];
                    return (
                       <div key={key} className="form-group" style={{flexDirection: 'row', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap'}}>
                          <input type="checkbox" id={key} checked={acc.active} onChange={e => handleAccessoryChange(key, 'active', e.target.checked)} />
                          <label htmlFor={key} style={{minWidth: '130px'}}>{acc.label}</label>
                          <input type="number" style={{width: '60px', padding: '0.2rem'}} value={acc.perc} onChange={e => handleAccessoryChange(key, 'perc', parseFloat(e.target.value)||0)} /> <label>%</label>
                       </div>
                    );
                 })}
             </div>
          </div>
        </div>

        <div className="sidebar">
          <div className="card">
            <h2 className="card-title">📄 Riepilogo Preventivo</h2>
            
            <div className="totals-box">
              <div className="totals-row">
                <span>Subtotale O³ (Base + Riprezzamento):</span>
                <span>€ {totaleNoloRicalcolato.toFixed(2)}</span>
              </div>
              
              {Object.keys(accessories).map(key => {
                 const acc = accessories[key];
                 if (acc.active) {
                    return (
                       <div key={key} className="totals-row">
                          <span>{acc.label} {(key === 'ritiri' ? '(Dinamica)' : '(' + acc.perc + '%)')}:</span>
                          <span>+ € {mList[key].toFixed(2)}</span>
                       </div>
                    );
                 }
                 return null;
              })}

              <div className="totals-final">
                <span>TOTALE</span>
                <span>{isGlobalError ? 'ERRORE RIGA' : `€ ${totaleFinale.toFixed(2)}`}</span>
              </div>
            </div>
            
            <p style={{fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '1rem'}}>
               * I prezzi sono indicativi. Riferimento Listino selezionato: <b>{formatListinoName(listino)}</b>.
               Assicurati che tutti i bancali risultino censiti (la voce "Tipo" non deve essere in errore rosso).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
