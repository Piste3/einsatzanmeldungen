<script setup>
// «Gefragt per»: Mündlich, Telefon oder WhatsApp für alle Karten
import { channel, setChannel } from '@/lib/handy.js';

const CHOICES = [['muendlich', 'hch-md', 'Mündlich'], ['telefon', 'hch-tel', 'Telefon'], ['whatsapp', 'hch-wa', 'WhatsApp']];
</script>

<template>
  <div class="h-channel" role="radiogroup" aria-label="Gefragt per">
    <span class="h-label">Gefragt per</span>
    <div class="segmented">
      <template v-for="[v, id, label] in CHOICES" :key="v"><input :id="id" type="radio" name="h-channel" :value="v" :checked="channel === v" @change="setChannel(v)"><label :for="id">{{ label }}</label></template>
    </div>
  </div>
</template>
