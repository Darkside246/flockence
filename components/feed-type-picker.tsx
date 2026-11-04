"use client";
import {useState} from "react";

// Stage order and wording follow the manufacturers' Barbados poultry catalogues.
// https://rmco.com/pinnaclefeeds/animal-feeding-program/poultry-feeds-broilers/
// https://rmco.com/pinnaclefeeds/animal-feeding-program/poultry-feeds-layers/
// https://www.superfeedsmill.com/products
const feeds:Record<string,string[]>={
  "Pinnacle Feeds":[
    "Broiler Starter","Broiler Grower","Broiler Finisher",
    "Chick Starter","Growing Ration","Super Layer 18%","Cage Layer 17%"
  ],
  "Super Feeds":[
    "Broiler Pre-Starter","Broiler Starter","Broiler Starter (crumble)",
    "Broiler Grower","Broiler Grower (crumble)","Broiler Grower (pellet)",
    "Broiler Finisher","Broiler Finisher (pellet)","Pullet (Chick) Starter",
    "Pullet Grower Ration","Pullet Developer","Pre-Layer 15Wks - 5%","Pre-Peak Layer",
    "Layer 50% - 32Wks","Layer 32-44Wks","Layer 44-55Wks","Layer 55 Wks Plus",
    "Layer 17%","Super Layer 18%"
  ]
};
export function FeedTypePicker({value,onChange,required=true}:{value:string;onChange:(value:string)=>void;required?:boolean}){
  const [custom,setCustom]=useState(false);
  return <div><label>Feed type<select required={required} value={custom?"other":value} onChange={e=>{
    setCustom(e.target.value==="other");onChange(e.target.value==="other"?"":e.target.value);
  }}><option value="">Choose a brand and feeding stage</option>
    {Object.entries(feeds).map(([brand,products])=><optgroup key={brand} label={brand}>{products.map(name=><option key={name} value={brand+" · "+name}>{name}</option>)}</optgroup>)}
    <option value="other">Other brand or formula</option></select></label>
    {custom && <label>Feed name on the bag<input required maxLength={160} value={value} onChange={e=>onChange(e.target.value)} placeholder="Brand and feed type"/></label>}</div>;
}
